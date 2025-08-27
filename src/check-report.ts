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

  octokit: OctokitType;

  items: SummaryRow[] = [];

  containsFailure = false;
  stillRunning = false;
  shouldRetry = true;

  constructor(
    token: string,
    owner: string,
    repo: string,
    sha: string,
    ignoredNamePatterns: string,
    currentJobName: string
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
        subCheckRuns.forEach(checkRun => {
          // dark corners of github API: there is no way to get "last check run" for a ref
          // so we filter out them by app.id/names

          if (checkRun.name.includes('${{')) {
            // dark dark corners of github API: names can be not fully interpreted
            // ignoring them
            core.debug(`Skipping GitHub Actions check run ${checkRun.html_url}`);
            return;
          }

          const key = `${checkRun.app?.id}#${checkRun.name}`;

          if (key in checkRuns) {
            core.debug(`Duplicate check run ${checkRun.html_url}`);
            if (checkRun.id > checkRuns[key].id) {
              // pick the last one
              checkRuns[key] = checkRun;
            }
          } else {
            checkRuns[key] = checkRun;
          }
        });
      }
    }

    core.info(`Found ${Object.keys(checkRuns).length} check runs`);

    const statuses = await this.getAllCombinedStatuses();
    core.info(`Found ${statuses.length} commit statuses`);

    for (const check of Object.values(checkRuns)) {
      this.items.push(SummaryRow.fromCheck(check, this.ignoredNameRegexps, this.currentJobName));
    }

    for (const status of statuses) {
      this.items.push(SummaryRow.fromStatus(status, this.ignoredNameRegexps));
    }

    this.compute();
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
