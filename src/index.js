const core = require('@actions/core');
const github = require('@actions/github');

async function sleep(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const initialDelaySecondsInput = core.getInput('initial-delay-seconds') || '60';
    const maxRetriesInput = core.getInput('max-retries') || '5';
    const retryIntervalSecondsInput = core.getInput('polling-interval') || '60';

    const initialDelaySeconds = parseInt(initialDelaySecondsInput, 10);
    const maxRetries = parseInt(maxRetriesInput, 10);
    const retryIntervalSeconds = parseInt(retryIntervalSecondsInput, 10);

    const octokit = github.getOctokit(token);
    const { owner, repo } = github.context.repo;
    const pr = github.context.payload.pull_request;

    if (!pr) {
      core.setFailed('This action must be run on a pull_request event.');
      return;
    }

    const sha = pr.head.sha;
    const currentWorkflow = github.context.workflow;
    const currentJob = github.context.job;

    core.info(`Sleeping for ${initialDelaySeconds} seconds before starting checks...`);
    await sleep(initialDelaySeconds);

    let retriesLeft = maxRetries;
    while (true) {
      core.info(`Checking CI statuses for commit: ${sha}`);

      // Fetch check runs
      const { data: checkRunsData } = await octokit.rest.checks.listForRef({
        owner,
        repo,
        ref: sha,
      });
      const checkRuns = checkRunsData.check_runs || [];

      // Fetch commit statuses
      const { data: statusData } = await octokit.rest.repos.getCombinedStatusForRef({
        owner,
        repo,
        ref: sha,
      });
      const statuses = statusData.statuses || [];

      let failures = [];
      let stillRunning = false;

      // Analyze check runs
      for (const check of checkRuns) {
        if (check.name === currentWorkflow || check.name === currentJob) {
          core.info(`Skipping current running check: ${check.name}`);
          continue;  // Skip our own job
        }
        if (check.status === 'queued' || check.status === 'in_progress') {
          stillRunning = true;
        } else if (check.conclusion !== 'success' && check.conclusion !== 'skipped') {
          failures.push(`❌ Check Run Failed: ${check.name} (conclusion: ${check.conclusion})`);
        }
      }

      // Analyze commit statuses
      for (const status of statuses) {
        if (status.state === 'pending') {
          stillRunning = true;
        } else if (status.state !== 'success') {
          failures.push(`❌ Commit Status Failed: ${status.context} (state: ${status.state})`);
        }
      }

      if (failures.length > 0) {
        core.setFailed(`Some CI checks or statuses failed:\n${failures.join('\n')}`);
        return;
      }

      if (!stillRunning) {
        core.info('✅ All CI checks and statuses passed or were skipped.');
        return;
      }

      // If still running and retries left
      if (retriesLeft > 0) {
        core.info(`Some checks are still running. Waiting ${retryIntervalSeconds} seconds before retrying... (${retriesLeft} retries left)`);
        retriesLeft--;
        await sleep(retryIntervalSeconds);
      } else {
        core.setFailed('Timed out waiting for CI checks to finish.');
        return;
      }
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
