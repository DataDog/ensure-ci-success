import * as core from '@actions/core';
import * as github from '@actions/github';
import { Octokit } from '@octokit/rest';

import { CheckReport } from './check-report';

async function sleep(seconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

async function run(): Promise<void> {
  try {
    const token = core.getInput('github-token', { required: true });
    const initialDelaySeconds = parseInt(core.getInput('initial-delay-seconds') || '5', 10);
    const maxRetries = parseInt(core.getInput('max-retries') || '5', 10);
    const retryIntervalSeconds = parseInt(core.getInput('polling-interval') || '60', 10);
    const ignoredNamePatterns = core.getInput('ignored-name-patterns') || '';
    const octokit = new Octokit({ auth: token });
    const { owner, repo } = github.context.repo;
    const pr = github.context.payload.pull_request;

    if (!pr) {
      core.setFailed('This action must be run on a pull_request event.');
      return;
    }

    const report = new CheckReport(
      owner,
      repo,
      pr.head.sha,
      ignoredNamePatterns,
      github.context.job
    );

    core.info(`Checking CI statuses for commit: ${report.sha}`);

    const { data: run } = await octokit.rest.actions.getWorkflowRun({
      owner,
      repo,
      run_id: github.context.runId,
    });

    if (run.run_attempt !== 1) {
      core.info(
        `This is the #${run.run_attempt} attempt of the workflow, performing an initial check.`
      );
      await report.fill(octokit);
    }

    let currentRetry = 1;

    while (report.shouldRetry && currentRetry <= maxRetries) {
      const delay = currentRetry === 1 ? initialDelaySeconds : retryIntervalSeconds;
      core.info(`Waiting ${delay}s (${maxRetries - currentRetry + 1} retries left).`);
      await sleep(delay);
      await report.fill(octokit);

      currentRetry++;
    }

    if (report.shouldRetry && currentRetry > maxRetries) {
      const message = '❌ Some checks are still running, but we are not retrying anymore.';
      core.setFailed(message);
      core.info(message);
    }

    await report.print();
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}

run();
