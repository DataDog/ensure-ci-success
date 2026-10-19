import * as fs from 'fs';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { SummaryRow, Interpretation } from './summary-row';

import { StatusType, CheckRunType, OctokitType } from './types';
import { setFailed } from './utils';

function fancyInterpretation(interpreted: Interpretation) {
  switch (interpreted) {
    case Interpretation.Success:
      return '✅ All good!';
    case Interpretation.Failure:
      return '❌ Something failed.';
    case Interpretation.StillRunning:
      return '⏳ Still running...';
    case Interpretation.CurrentJob:
      return '🙈 Current job';
    case Interpretation.Ignored:
      return '🙈 Ignored';
    default:
      return '⚠️ Unknown status';
  }
}

export class CheckReport {
  owner: string;
  repo: string;
  sha: string;
  ignoredNameRegexps: RegExp[];
  currentJobName: string;
  currentHeadRef: string | null;
  ignoreForeignCheckRuns: boolean;

  octokit: OctokitType;

  items: SummaryRow[] = [];

  private workflowRunOrigins = new Map<
    string,
    { headRepositoryFullName: string | null; headBranch: string | null } | null
  >();

  containsFailure = false;
  stillRunning = false;
  shouldRetry = true;

  constructor(
    token: string,
    owner: string,
    repo: string,
    sha: string,
    ignoredNamePatterns: string,
    currentJobName: string,
    currentHeadRef: string | null = null,
    ignoreForeignCheckRuns = false
  ) {
    this.owner = owner;
    this.repo = repo;
    this.sha = sha;
    this.ignoredNameRegexps = ignoredNamePatterns
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean)
      .map(pattern => new RegExp(`^${pattern}$`));
    this.currentJobName = currentJobName;
    this.currentHeadRef = currentHeadRef;
    this.ignoreForeignCheckRuns = ignoreForeignCheckRuns;
    this.octokit = github.getOctokit(token);
  }

  async fill(): Promise<void> {
    this.items.length = 0; // Clear the array

    const checkSuites = await this.octokit.paginate(this.octokit.rest.checks.listSuitesForRef, {
      owner: this.owner,
      repo: this.repo,
      ref: this.sha,
      per_page: 100,
    });

    const checkRuns: Record<string, CheckRunType> = {};
    const foreignCheckRuns: Record<string, CheckRunType> = {};

    for (const suite of checkSuites) {
      if (suite.latest_check_runs_count === 0) {
        core.debug(`Check suite ${suite.id} has no check runs (${suite.url})`);
      } else {
        // we cannot skip any suite, because rerun may have been triggered
        core.info(
          `Get ${suite.latest_check_runs_count} runs for check suite ${suite.url} (conclusion: ${suite.conclusion})`
        );
        const subCheckRuns = await this.octokit.paginate(this.octokit.rest.checks.listForSuite, {
          owner: this.owner,
          repo: this.repo,
          check_suite_id: suite.id,
          per_page: 100,
        });
        for (const checkRun of subCheckRuns) {
          // dark corners of github API: there is no way to get "last check run" for a ref
          // so we filter out them by app.id/names

          if (checkRun.name.includes('${{')) {
            // dark dark corners of github API: names can be not fully interpreted
            // ignoring them
            core.debug(`Skipping GitHub Actions check run ${checkRun.html_url}`);
            continue;
          }

          // Check runs are enumerated per commit, not per pull request, so a
          // commit shared by a fork PR and its in-repo shadow PR carries two
          // sets of identically-named runs. Keep them apart so the dedupe
          // below cannot let a stale fork run shadow the PR's own run.
          const isForeign = this.ignoreForeignCheckRuns && (await this.isForeignCheckRun(checkRun));
          const target = isForeign ? foreignCheckRuns : checkRuns;

          const key = `${checkRun.app?.id}#${checkRun.name}`;

          if (key in target) {
            core.debug(`Duplicate check run ${checkRun.html_url}`);
            if (checkRun.id > target[key].id) {
              // pick the last one
              target[key] = checkRun;
            }
          } else {
            target[key] = checkRun;
          }
        }
      }
    }

    core.info(`Found ${Object.keys(checkRuns).length} check runs`);

    const statuses = await this.getAllCombinedStatuses();
    core.info(`Found ${statuses.length} commit statuses`);

    for (const check of Object.values(checkRuns)) {
      this.items.push(SummaryRow.fromCheck(check, this.ignoredNameRegexps, this.currentJobName));
    }

    for (const check of Object.values(foreignCheckRuns)) {
      core.info(
        `* 🙈 Ignoring check run from another pull request: ${check.name} (${check.html_url})`
      );
      this.items.push(
        SummaryRow.fromCheck(check, this.ignoredNameRegexps, this.currentJobName, true)
      );
    }

    for (const status of statuses) {
      this.items.push(SummaryRow.fromStatus(status, this.ignoredNameRegexps));
    }

    this.compute();
  }

  /**
   * Returns true when the check run was produced by a workflow running against
   * a fork repository and does not belong to the pull request under
   * evaluation. Such runs happen when a fork PR and an in-repo shadow PR
   * share the same head commit: both trigger identically-named check runs on
   * that commit.
   */
  private async isForeignCheckRun(checkRun: CheckRunType): Promise<boolean> {
    if (checkRun.app?.slug !== 'github-actions') {
      // Third-party check runs carry no workflow run to attribute them with.
      return false;
    }

    const runId = this.extractWorkflowRunId(checkRun.html_url);
    if (runId === null) {
      return false;
    }

    const origin = await this.getWorkflowRunOrigin(runId);
    if (!origin) {
      return false;
    }

    return (
      origin.headRepositoryFullName !== `${this.owner}/${this.repo}` &&
      origin.headBranch !== this.currentHeadRef
    );
  }

  private extractWorkflowRunId(htmlUrl: string | null | undefined): string | null {
    if (!htmlUrl) {
      return null;
    }
    const match = htmlUrl.match(/\/actions\/runs\/(\d+)/);
    return match ? match[1] : null;
  }

  private async getWorkflowRunOrigin(runId: string): Promise<{
    headRepositoryFullName: string | null;
    headBranch: string | null;
  } | null> {
    if (this.workflowRunOrigins.has(runId)) {
      return this.workflowRunOrigins.get(runId) ?? null;
    }

    try {
      const { data } = await this.octokit.rest.actions.getWorkflowRun({
        owner: this.owner,
        repo: this.repo,
        run_id: parseInt(runId, 10),
      });
      const origin = {
        headRepositoryFullName: data.head_repository?.full_name ?? null,
        headBranch: data.head_branch ?? null,
      };
      this.workflowRunOrigins.set(runId, origin);
      return origin;
    } catch (error) {
      core.warning(`Could not resolve workflow run ${runId} to attribute its check run: ${error}`);
      this.workflowRunOrigins.set(runId, null);
      return null;
    }
  }

  private async getAllCombinedStatuses(): Promise<StatusType[]> {
    const allStatuses = [];
    const pagedParams = {
      owner: this.owner,
      repo: this.repo,
      ref: this.sha,
      per_page: 100,
      page: 1,
    };

    while (true) {
      const { data } = await this.octokit.rest.repos.getCombinedStatusForRef(pagedParams);

      allStatuses.push(...data.statuses);

      if (data.statuses.length < pagedParams.per_page) {
        break;
      }

      pagedParams.page++;
    }

    return allStatuses;
  }

  private compute(): void {
    this.containsFailure = false;
    this.stillRunning = false;

    let currentJobIsFound = false;

    for (const row of this.items) {
      if (row.interpreted === Interpretation.CurrentJob) {
        core.info(`* 🙈 Skipping current running check: ${row.name}`);
        currentJobIsFound = true;
      } else if (row.interpreted === Interpretation.Ignored) {
        core.info(`* 🙈 Ignoring ${row.name} (matched ignore pattern)`);
      } else if (row.interpreted === Interpretation.StillRunning) {
        core.info(`* ⏳ ${row.name} is still running (state: ${row.status})`);
        this.stillRunning = true;
      } else if (row.interpreted === Interpretation.Failure) {
        core.info(`* ❌ Check Run Failed: ${row.name} (status: ${row.status})`);
        this.containsFailure = true;
      }
    }

    if (!currentJobIsFound) {
      core.warning(
        `⏳ The current job (${this.currentJobName}) has not yet been reported — likely caused by check_runs API lag.`
      );
      this.stillRunning = true;
    }

    if (this.containsFailure) {
      setFailed('❌ Some CI checks or statuses failed, please check the summary table.');
      this.shouldRetry = false;
    } else if (!this.stillRunning) {
      core.info('✅ All CI checks and statuses passed or were skipped.');
      this.shouldRetry = false;
    } else {
      core.info('⏳ Some checks are still running');
      this.shouldRetry = true;
    }
  }

  async print(fullDetails: boolean): Promise<void> {
    let header = '';
    let itemsToShow = this.items;

    if (!fullDetails) {
      const ignoredCount = itemsToShow.filter(
        item => item.interpreted === Interpretation.Ignored
      ).length;
      const successCount = itemsToShow.filter(
        item => item.interpreted === Interpretation.Success
      ).length;
      itemsToShow = itemsToShow.filter(
        item =>
          item.interpreted === Interpretation.Failure ||
          item.interpreted === Interpretation.StillRunning
      );
      header += `\n> ℹ️ ${successCount} successful, ${ignoredCount} ignored. Enable full-details-summary to see them.\n\n`;
    }

    const tableHeader =
      '| Check Name | Source | Start Time | Duration | Status | Interpreted as |\n' +
      '|------------|--------|------------|----------|--------|----------------|\n';

    const markdownRows = itemsToShow
      .map(row => {
        const durationSeconds = row.duration != null ? `${Math.round(row.duration)}s` : '-';
        const nameLink = row.url ? `[${row.name}](${row.url})` : row.name;

        return `| ${nameLink} | ${row.source} | ${row.start || '-'} | ${durationSeconds} | ${row.status} | ${fancyInterpretation(row.interpreted)} |`;
      })
      .join('\n');

    const fullSummary = header + tableHeader + markdownRows + '\n';

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      await fs.promises.appendFile(summaryPath, fullSummary, 'utf8');
    } else {
      core.info('GITHUB_STEP_SUMMARY not available');
      core.info(fullSummary);
    }
  }
}
