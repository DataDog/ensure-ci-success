import * as core from '@actions/core';
import * as github from '@actions/github';

import { CheckReport } from './check-report';
import { setFailed } from './utils';

async function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export async function run(): Promise<void> {
  try {
    const { owner, repo } = github.context.repo;
    const pr = github.context.payload.pull_request;
    const token = core.getInput('github-token', { required: true });
    const ignoredNamePatterns = core.getInput('ignored-name-patterns') || '';
    const initialDelaySeconds = parseInt(core.getInput('initial-delay-seconds') || '5', 10);
    const maxRetries = parseInt(core.getInput('max-retries') || '5', 10);
    const retryIntervalSeconds = parseInt(core.getInput('polling-interval') || '60', 10);
    const fullDetailsSummary = core.getInput('full-details-summary') === 'true';

    let sha = '';

    if (pr) {
      sha = pr.head.sha;
      core.info(`Checking CI statuses for commit: ${sha} on PR #${pr.number}`);
    } else {
      sha = github.context.sha;
      core.info(`Checking CI statuses for commit: ${sha} on push event`);
    }

    const report = new CheckReport(
      token,
      owner,
      repo,
      sha,
      ignoredNamePatterns,
      github.context.job
    );

    const { data: run } = await report.octokit.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: github.context.runId,
    });

    if (run.run_attempt !== 1) {
      core.info(
        `This is the #${run.run_attempt} attempt of the workflow, performing an initial check.`
      );
      await report.fill();
    }

    let currentRetry = 1;

    while (report.shouldRetry && currentRetry <= maxRetries) {
      const delay = currentRetry === 1 ? initialDelaySeconds : retryIntervalSeconds;
      core.info(`Waiting ${delay}s (${maxRetries - currentRetry + 1} retries left).`);
      await sleep(delay);
      await report.fill();

      currentRetry++;
    }

    if (report.shouldRetry && currentRetry > maxRetries) {
      setFailed('❌ Some checks are still running, but we are not retrying anymore.');
    }

    await report.print(fullDetailsSummary);
  } catch (error) {
    core.error((error as Error).stack || '');
    setFailed((error as Error).message);
  }
}
