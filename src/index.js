const core = require('@actions/core');
const github = require('@actions/github');

async function run() {
  try {
    const token = core.getInput('github-token', { required: true });
    const octokit = github.getOctokit(token);

    const { owner, repo } = github.context.repo;
    const pr = github.context.payload.pull_request;

    if (!pr) {
      core.setFailed('This action must be run on a pull_request event.');
      return;
    }

    const sha = pr.head.sha;

    core.info(`Checking CI statuses for commit: ${sha}`);

    // Get check runs
    const { data: checkRunsData } = await octokit.rest.checks.listForRef({
      owner,
      repo,
      ref: sha,
    });

    const checkRuns = checkRunsData.check_runs || [];

    // Get commit statuses
    const { data: statusData } = await octokit.rest.repos.getCombinedStatusForRef({
      owner,
      repo,
      ref: sha,
    });

    const statuses = statusData.statuses || [];

    let failures = [];

    // Analyze check runs
    for (const check of checkRuns) {
      if (check.conclusion !== 'success' && check.conclusion !== 'skipped') {
        failures.push(`❌ Check Run Failed: ${check.name} (conclusion: ${check.conclusion})`);
      }
    }

    // Analyze commit statuses
    for (const status of statuses) {
      if (status.state !== 'success') {
        failures.push(`❌ Commit Status Failed: ${status.context} (state: ${status.state})`);
      }
    }

    if (failures.length > 0) {
      core.setFailed(`Some CI checks or statuses failed:\n${failures.join('\n')}`);
    } else {
      core.info('✅ All CI checks and statuses passed or were skipped.');
    }

  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
