import * as fs from 'fs';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';

import { StatusType, CheckRunType } from './types';
import { SummaryRow, Interpretation } from './summary-row';

async function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
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

async function writeSummaryTable(rows: SummaryRow[]): Promise<void> {
  const header =
    '| Check Name | Source | Start Time | Duration | Status | Interpreted as |\n' +
    '|------------|--------|------------|----------|--------|----------------|\n';

  const markdownRows = rows
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

async function getSummaryRows(
  octokit: Octokit,
  sha: string,
  ignoredNameRegexps: RegExp[]
): Promise<SummaryRow[]> {
  const { owner, repo } = github.context.repo;
  const currentJobName = github.context.job;

  const checkSuites = await octokit.paginate(octokit.rest.checks.listSuitesForRef, {
    owner,
    repo,
    ref: sha,
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
        owner,
        repo,
        check_suite_id: suite.id,
        per_page: 100,
      });
      checkRuns.push(...subCheckRuns);
    }
  }

  core.info(`Found ${checkRuns.length} check runs`);

  const statuses = await getAllCombinedStatuses(octokit, { owner, repo, ref: sha });
  core.info(`Found ${statuses.length} commit statuses`);

  const summaryRows: SummaryRow[] = [];

  for (const check of checkRuns) {
    summaryRows.push(SummaryRow.fromCheck(check, ignoredNameRegexps, currentJobName));
  }

  for (const status of statuses) {
    summaryRows.push(SummaryRow.fromStatus(status, ignoredNameRegexps));
  }

  return summaryRows;
}

async function performCheckLoop(
  octokit: Octokit,
  sha: string,
  ignoredNameRegexps: RegExp[],
  maxRetries: number,
  retryIntervalSeconds: number
): Promise<SummaryRow[]> {
  let currentRetry = 1;
  let summaryRows: SummaryRow[];

  core.info(`Checking CI statuses for commit: ${sha}`);

  while (true) {
    summaryRows = await getSummaryRows(octokit, sha, ignoredNameRegexps);

    const failures: SummaryRow[] = [];
    let stillRunning = false;
    let currentJobIsFound = false;

    for (const row of summaryRows) {
      if (row.interpreted === Interpretation.CurrentJob) {
        core.info(`Skipping current running check: ${row.name}`);
        currentJobIsFound = true;
      } else if (row.interpreted === Interpretation.Ignored) {
        core.info(`Ignoring commit status ${row.name} (matched ignore pattern)`);
      } else if (row.interpreted === Interpretation.StillRunning) {
        core.info(`⏳ ${row.name} is still running (state: ${row.status})`);
        stillRunning = true;
      } else if (row.interpreted === Interpretation.Failure) {
        core.info(`❌ Check Run Failed: ${row.name} (status: ${row.status})`);
        failures.push(row);
      }
    }

    if (!currentJobIsFound) {
      core.warning(
        '❌ The current job has not yet been reported — likely caused by check_runs API lag.'
      );
    }

    if (failures.length > 0) {
      core.setFailed('Some CI checks or statuses failed, please check the summary table.');
      break;
    } else if (!stillRunning && currentJobIsFound) {
      core.info('✅ All CI checks and statuses passed or were skipped.');
      break;
    } else if (currentRetry === maxRetries) {
      core.setFailed('Timed out waiting for CI checks to finish.');
      break;
    } else {
      core.info(
        `Some checks are still running, waiting ${retryIntervalSeconds}s before retrying (${maxRetries - currentRetry} retries left).`
      );
      await sleep(retryIntervalSeconds);
      currentRetry++;
    }
  }

  return summaryRows;
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true });
    const initialDelaySeconds = parseInt(core.getInput('initial-delay-seconds') || '0', 10);
    const maxRetries = parseInt(core.getInput('max-retries') || '5', 10);
    const retryIntervalSeconds = parseInt(core.getInput('polling-interval') || '60', 10);
    const ignoredNamePatterns = core.getInput('ignored-name-patterns') || '';

    const ignoredNameRegexps = ignoredNamePatterns
      .split('\n')
      .map(p => p.trim())
      .filter(Boolean)
      .map(pattern => new RegExp(`^${pattern}$`));

    const octokit = new Octokit({ auth: token });
    const { owner, repo } = github.context.repo;
    const pr = github.context.payload.pull_request;

    if (!pr) {
      core.setFailed('This action must be run on a pull_request event.');
      return;
    }

    const { data: run } = await octokit.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: github.context.runId,
    });

    if (run.run_attempt === 1) {
      core.info(
        `This is the first run of the workflow, waiting ${initialDelaySeconds}s before checking CI statuses.`
      );
      await sleep(initialDelaySeconds);
    } else {
      core.info('This is not the first run of the workflow, skipping initial delay.');
    }

    const summaryRows = await performCheckLoop(
      octokit,
      pr.head.sha,
      ignoredNameRegexps,
      maxRetries,
      retryIntervalSeconds
    );

    await writeSummaryTable(summaryRows);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();
