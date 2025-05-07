import * as fs from 'fs';
import * as core from '@actions/core';
import { Octokit } from '@octokit/rest';
import { SummaryRow, Interpretation } from './summary-row';

import { StatusType, CheckRunType } from './types';

async function getAllCombinedStatuses(
  octokit: Octokit,
  params: { owner: string; repo: string; ref: string }
): Promise<StatusType[]> {
  const allStatuses = [];
  const pagedParams = { ...params, per_page: 100, page: 1 };

  while (true) {
    const { data } = await octokit.rest.repos.getCombinedStatusForRef(pagedParams);

    allStatuses.push(...data.statuses);

    if (data.statuses.length < pagedParams.per_page) {
      break;
    }

    pagedParams.page++;
  }

  return allStatuses;
}

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

  items: SummaryRow[] = [];

  containsFailure = false;
  stillRunning = false;
  shouldRetry = true;

  constructor(
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
  }

  async fill(octokit: Octokit): Promise<void> {
    this.items.length = 0; // Clear the array

    const checkSuites = await octokit.paginate(octokit.rest.checks.listSuitesForRef, {
      owner: this.owner,
      repo: this.repo,
      ref: this.sha,
      per_page: 100,
    });

    const checkRuns: CheckRunType[] = [];

    for (const suite of checkSuites) {
      if (suite.latest_check_runs_count === 0) {
        core.debug(`Check suite ${suite.id} has no check runs (${suite.url}`);
      } else if (
        suite.conclusion !== null &&
        ['success', 'neutral', 'skipped'].includes(suite.conclusion)
      ) {
        core.info(
          `Check suite ${suite.id} conclusion is ${suite.conclusion} (${suite.latest_check_runs_count} runs) (${suite.url})`
        );
      } else {
        core.info(`Get ${suite.latest_check_runs_count} runs for check suite ${suite.url}`);
        const subCheckRuns = await octokit.paginate(octokit.rest.checks.listForSuite, {
          owner: this.owner,
          repo: this.repo,
          check_suite_id: suite.id,
          per_page: 100,
        });
        checkRuns.push(...subCheckRuns);
      }
    }

    core.info(`Found ${checkRuns.length} check runs`);

    const statuses = await getAllCombinedStatuses(octokit, {
      owner: this.owner,
      repo: this.repo,
      ref: this.sha,
    });
    core.info(`Found ${statuses.length} commit statuses`);

    for (const check of checkRuns) {
      this.items.push(SummaryRow.fromCheck(check, this.ignoredNameRegexps, this.currentJobName));
    }

    for (const status of statuses) {
      this.items.push(SummaryRow.fromStatus(status, this.ignoredNameRegexps));
    }

    this.compute();
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
        '⏳ The current job has not yet been reported — likely caused by check_runs API lag.'
      );
      this.stillRunning = true;
    }

    if (this.containsFailure) {
      core.setFailed('❌ Some CI checks or statuses failed, please check the summary table.');
      this.shouldRetry = false;
    } else if (!this.stillRunning) {
      core.info('✅ All CI checks and statuses passed or were skipped.');
      this.shouldRetry = false;
    } else {
      core.info('⏳ Some checks are still running');
      this.shouldRetry = true;
    }
  }

  async print(): Promise<void> {
    const header =
      '| Check Name | Source | Start Time | Duration | Status | Interpreted as |\n' +
      '|------------|--------|------------|----------|--------|----------------|\n';

    const markdownRows = this.items
      .map(row => {
        const durationSeconds = row.duration != null ? `${Math.round(row.duration)}s` : '-';
        const nameLink = row.url ? `[${row.name}](${row.url})` : row.name;

        return `| ${nameLink} | ${row.source} | ${row.start || '-'} | ${durationSeconds} | ${row.status} | ${fancyInterpretation(row.interpreted)} |`;
      })
      .join('\n');

    const fullTable = header + markdownRows + '\n';

    const summaryPath = process.env.GITHUB_STEP_SUMMARY;
    if (summaryPath) {
      await fs.promises.appendFile(summaryPath, fullTable, 'utf8');
    } else {
      core.info('GITHUB_STEP_SUMMARY not available');
      core.info(fullTable);
    }
  }
}
