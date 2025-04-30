const fs = require('fs');
const core = require('@actions/core');
const github = require('@actions/github');

async function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function writeSummaryTable(rows) {
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
    return;
  } else {
    core.info('GITHUB_STEP_SUMMARY not available');
    core.info(fullTable);
  }
}

async function getAllCombinedStatuses(octokit, { owner, repo, ref }) {
  // getCombinedStatusForRef does not supports octokit.paginate
  // so let code it ourselves

  const params = {
    owner,
    repo,
    ref,
    per_page: 100,
    page: 1,
  };
  const allStatuses = [];

  while (true) {
    const { data } = await octokit.rest.repos.getCombinedStatusForRef(params);

    allStatuses.push(...(data.statuses || []));

    if (data.statuses.length < params.per_page) {
      break; // we're on the last page
    }

    params.page++;
  }

  return allStatuses;
}

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const initialDelaySecondsInput = core.getInput('initial-delay-seconds') || '0';
    const maxRetriesInput = core.getInput('max-retries') || '5';
    const retryIntervalSecondsInput = core.getInput('polling-interval') || '60';
    const ignoredNamePatterns = core.getInput('ignored-name-patterns') || '';

    const initialDelaySeconds = parseInt(initialDelaySecondsInput, 10);
    const maxRetries = parseInt(maxRetriesInput, 10);
    const retryIntervalSeconds = parseInt(retryIntervalSecondsInput, 10);

    const ignoredNameRegexps = ignoredNamePatterns
      .split('\n')
      .map(p => p.trim())
      .filter(p => p.length > 0)
      .map(pattern => new RegExp(`^${pattern}$`));

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pr = github.context.payload.pull_request;

    if (!pr) {
      core.setFailed('This action must be run on a pull_request event.');
      return;
    }

    const sha = pr.head.sha;
    const currentJob = github.context.job;

    core.info(`Current job: ${currentJob}`);

    core.info(`Checking CI statuses for commit: ${sha}`);

    core.info(`Sleeping for ${initialDelaySeconds} seconds before starting checks...`);
    await sleep(initialDelaySeconds);

    let retriesLeft = maxRetries;
    while (true) {
      // octokit.rest.checks.listForRef does not work here because the token used in CI
      // can prevent access to the checks of the PR commit
      const workflowRuns = await octokit.paginate(octokit.rest.actions.listWorkflowRunsForRepo, {
        owner,
        repo,
        head_sha: sha,
        per_page: 100,
      });

      const checkRuns = [];
      for (const run of workflowRuns) {
        const jobs = await octokit.paginate(octokit.rest.actions.listJobsForWorkflowRun, {
          owner,
          repo,
          run_id: run.id,
        });
        checkRuns.push(...jobs);
      }

      // Fetch commit statuses
      const statuses = await getAllCombinedStatuses(octokit, { owner, repo, ref: sha });

      let failures = [];
      let stillRunning = false;
      const summaryRows = [];

      // Analyze check runs
      core.info(`Found ${checkRuns.length} check runs`);
      for (const check of checkRuns) {
        const row = {
          name: check.name,
          source: 'check run',
          status: check.conclusion || check.status,
          start: check.started_at,
          duration:
            check.completed_at && check.started_at
              ? (new Date(check.completed_at) - new Date(check.started_at)) / 1000
              : null,
          url: check.html_url,
          interpreted: null,
        };

        summaryRows.push(row);

        if (check.name === currentJob) {
          core.info(`Skipping current running check: ${check.name}`);
          row.interpreted = `🙈 Ignored (current job)`;
          continue; // Skip our own job
        }

        if (ignoredNameRegexps.some(regex => regex.test(check.name))) {
          core.info(`Ignoring check run (it matches an ignored pattern): ${check.name}`);
          row.interpreted = '🙈 Ignored';
          continue;
        }

        if (check.status === 'queued' || check.status === 'in_progress') {
          core.info(`⏳ ${check.name} is still running (status: ${check.status})`);
          stillRunning = true;
          row.interpreted = `⏳ ${check.status}`;
        } else if (check.conclusion === 'success' || check.conclusion === 'skipped') {
          row.interpreted = `✅ ${check.conclusion}`;
        } else {
          failures.push(`❌ Check Run Failed: ${check.name} (conclusion: ${check.conclusion})`);
          row.interpreted = `❌ ${check.conclusion}`;
        }
      }

      // Analyze commit statuses
      core.info(`Found ${statuses.length} statuses`);
      for (const status of statuses) {
        const row = {
          name: status.context,
          source: 'status',
          status: status.state,
          interpreted: null,
          start: status.created_at,
          duration:
            status.updated_at && status.created_at
              ? (new Date(status.updated_at) - new Date(status.created_at)) / 1000
              : null,
          url: status.target_url || null,
        };

        summaryRows.push(row);

        if (ignoredNameRegexps.some(regex => regex.test(status.context))) {
          core.info(`Ignoring check run (matched ignore pattern): ${status.context}`);
          row.interpreted = '🙈 Ignored';
          continue;
        }

        if (status.state === 'pending') {
          core.info(`⏳ ${status.name} is still running (state: ${status.state})`);
          stillRunning = true;
          row.interpreted = `⏳ ${status.state}`;
        } else if (status.state !== 'success') {
          row.interpreted = `❌ ${status.state}`;
          failures.push(`❌ Commit Status Failed: ${status.context} (state: ${status.state})`);
        } else {
          row.interpreted = `✅ ${status.state}`;
        }
      }

      if (failures.length > 0) {
        core.setFailed(`Some CI checks or statuses failed:\n${failures.join('\n')}`);
        await writeSummaryTable(summaryRows);
        return;
      }

      if (!stillRunning) {
        core.info('✅ All CI checks and statuses passed or were skipped.');
        await writeSummaryTable(summaryRows);
        return;
      }

      // If still running and retries left
      if (retriesLeft > 0) {
        core.info(
          `Some checks are still running. Waiting ${retryIntervalSeconds} seconds before retrying... (${retriesLeft} retries left)\n`
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
    core.setFailed(error.message);
  }
}

run();
