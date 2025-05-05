import * as fs from 'fs';
import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';
import { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';

interface SummaryRow {
  name: string;
  source: 'check run' | 'status';
  status: string;
  interpreted: string | null;
  start?: string;
  duration: number | null;
  url: string | null;
}

type StatusesType = GetResponseDataTypeFromEndpointMethod<
  Octokit['rest']['repos']['getCombinedStatusForRef']
>['statuses'];

async function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function writeSummaryTable(rows: SummaryRow[]): Promise<void> {
  const header =
    '| Check Name | Source | Start Time | Duration | Status | Interpreted as |\n' +
    '|------------|--------|------------|----------|--------|----------------|\n';

  const markdownRows = rows
    .map(row => {
      const durationSeconds = row.duration != null ? `${Math.round(row.duration)}s` : '-';
      const nameLink = row.url ? `[${row.name}](${row.url})` : row.name;

      return `| ${nameLink} | ${row.source} | ${row.start || '-'} | ${durationSeconds} | ${row.status} | ${row.interpreted} |`;
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
): Promise<StatusesType> {
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

    const sha = pr.head.sha;
    const currentJobName = github.context.job;

    core.info(`Checking CI statuses for commit: ${sha}`);
    core.info(`Sleeping for ${initialDelaySeconds} seconds before starting checks...`);
    await sleep(initialDelaySeconds);

    let retriesLeft = maxRetries;
    while (true) {
      const checkRuns = await octokit.paginate(octokit.rest.checks.listForRef, {
        owner,
        repo,
        ref: sha,
        per_page: 100,
      });

      const statuses = await getAllCombinedStatuses(octokit, { owner, repo, ref: sha });

      const failures: string[] = [];
      let stillRunning = false;
      let currentJobIsFound = false;
      const summaryRows: SummaryRow[] = [];

      // Check runs
      core.info(`Found ${checkRuns.length} check runs`);
      for (const check of checkRuns) {
        const row: SummaryRow = {
          name: check.name,
          source: 'check run',
          status: check.conclusion || check.status || 'unknown',
          interpreted: null,
          start: check.started_at || undefined,
          duration:
            check.completed_at && check.started_at
              ? (new Date(check.completed_at).getTime() - new Date(check.started_at).getTime()) /
                1000
              : null,
          url: check.html_url || null,
        };

        summaryRows.push(row);

        if (check.name === currentJobName && check.app?.slug === 'github-actions') {
          core.info(`Skipping current running check: ${check.name}`);
          row.interpreted = `🙈 Ignored (current job)`;
          currentJobIsFound = true;
          continue;
        }

        if (ignoredNameRegexps.some(regex => regex.test(check.name))) {
          core.info(`Ignoring check run (matched ignore pattern): ${check.name}`);
          row.interpreted = '🙈 Ignored';
          continue;
        }

        if (check.status === 'queued' || check.status === 'in_progress') {
          core.info(`⏳ ${check.name} is still running (status: ${check.status})`);
          stillRunning = true;
          row.interpreted = `⏳ ${check.status}`;
        } else if (['success', 'skipped', 'neutral'].includes(check.conclusion || '')) {
          row.interpreted = `✅ ${check.conclusion}`;
        } else {
          failures.push(`❌ Check Run Failed: ${check.name} (conclusion: ${check.conclusion})`);
          row.interpreted = `❌ ${check.conclusion}`;
        }
      }

      // Commit statuses
      core.info(`Found ${statuses.length} commit statuses`);
      for (const status of statuses) {
        const row: SummaryRow = {
          name: status.context,
          source: 'status',
          status: status.state,
          interpreted: null,
          start: status.created_at,
          duration:
            status.updated_at && status.created_at
              ? (new Date(status.updated_at).getTime() - new Date(status.created_at).getTime()) /
                1000
              : null,
          url: status.target_url || null,
        };

        summaryRows.push(row);

        if (ignoredNameRegexps.some(regex => regex.test(status.context))) {
          core.info(`Ignoring commit status (matched ignore pattern): ${status.context}`);
          row.interpreted = '🙈 Ignored';
          continue;
        }

        if (status.state === 'pending') {
          core.info(`⏳ ${status.context} is still running (state: ${status.state})`);
          stillRunning = true;
          row.interpreted = `⏳ ${status.state}`;
        } else if (status.state !== 'success') {
          failures.push(`❌ Commit Status Failed: ${status.context} (state: ${status.state})`);
          row.interpreted = `❌ ${status.state}`;
        } else {
          row.interpreted = `✅ ${status.state}`;
        }
      }

      if (failures.length > 0) {
        core.setFailed(`Some CI checks or statuses failed:\n${failures.join('\n')}`);
        await writeSummaryTable(summaryRows);
        return;
      }

      if (!currentJobIsFound) {
        core.warning(
          '❌ The current job has not yet been reported — likely caused by check_runs API lag.'
        );
      } else if (!stillRunning) {
        core.info('✅ All CI checks and statuses passed or were skipped.');
        await writeSummaryTable(summaryRows);
        return;
      }

      if (retriesLeft > 0) {
        core.info(
          `Some checks are still running. Waiting ${retryIntervalSeconds}s before retrying... (${retriesLeft} retries left)`
        );
        retriesLeft--;
        await sleep(retryIntervalSeconds);
      } else {
        core.setFailed('Timed out waiting for CI checks to finish.');
        await writeSummaryTable(summaryRows);
        return;
      }
    }
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();
