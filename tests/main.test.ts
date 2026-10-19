import { jest } from '@jest/globals';
import nock from 'nock';

import { core, mockCore } from './mocks/actions-core';
import { mockGithub } from './mocks/github';

const realSetTimeOut = global.setTimeout;

const main = await import('../src/main');

describe('ensure-ci-success functional test', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    global.setTimeout = jest.fn((cb: () => void) => {
      cb();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout;

    nock.cleanAll(); // ensure a clean slate
    nock.disableNetConnect(); // prevent real HTTP calls
    mockCore.resetMockedInputs();
  });

  afterEach(() => {
    global.setTimeout = realSetTimeOut;
    nock.enableNetConnect();
  });

  it('succeed with a generic scenario', async () => {
    mockCore.mockInput('ignored-name-patterns', 'ignored-job');
    mockGithub()
      .setupContextWithPullRequest()
      .addActionRun()
      .addCheckSuite()
      .addCheckRun()
      .addEmptyCommitStatuses();

    await main.run();

    expect(global.setTimeout).toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(
      `Checking CI statuses for commit: abc123def456 on PR #42`
    );
    expect(core.debug).toHaveBeenCalledWith(
      'Check suite 666 has no check runs (https://api.github.com/repos/github/hello-world/check-suites/5)'
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('succeed with a push event', async () => {
    mockCore.mockInput('ignored-name-patterns', 'ignored-job');
    mockGithub()
      .setupContextWithoutPullRequest()
      .addActionRun()
      .addCheckSuite()
      .addCheckRun()
      .addEmptyCommitStatuses();

    await main.run();

    expect(core.info).toHaveBeenCalledWith(
      `Checking CI statuses for commit: abc123def456 on push event`
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('does not sleep for any job retry', async () => {
    mockCore.mockInput('ignored-name-patterns', 'ignored-job');
    mockGithub()
      .setupContextWithPullRequest()
      .addActionRun({ run_attempt: 2 })
      .addCheckSuite()
      .addCheckRun()
      .addEmptyCommitStatuses();

    await main.run();

    expect(global.setTimeout).not.toHaveBeenCalled();
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fail if there is a failure', async () => {
    mockGithub()
      .setupContextWithPullRequest()
      .addActionRun()
      .addCheckSuite()
      .addFailedCheckRun()
      .addEmptyCommitStatuses();

    await main.run();

    expect(core.setFailed).toHaveBeenCalled();
  });

  it('Read input', async () => {
    mockCore.mockInput('ignored-name-patterns', 'ignored-job\nfailed-job\nfailed-status');
    mockGithub()
      .setupContextWithPullRequest()
      .addActionRun()
      .addCheckSuite()
      .addFailedCheckRun()
      .addFailedStatus();

    await main.run();

    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('ignores failing check runs coming from another pull request', async () => {
    mockCore.mockInput('ignore-check-runs-from-other-pull-requests', 'true');
    mockGithub()
      .setupContextWithPullRequest({ headRef: 'pr-branch' })
      .addActionRun()
      .addCheckSuite()
      .addForeignAndLocalCheckRuns()
      .addWorkflowRunOrigins()
      .addEmptyCommitStatuses();

    await main.run();

    // the fork's failing 'some-job' run is ignored; the repository's own
    // successful 'some-job' run still counts
    expect(core.info).toHaveBeenCalledWith(
      expect.stringContaining('Ignoring check run from another pull request: some-job')
    );
    expect(core.setFailed).not.toHaveBeenCalled();
  });

  it('fails on fork check runs when the option is disabled', async () => {
    mockGithub()
      .setupContextWithPullRequest({ headRef: 'pr-branch' })
      .addActionRun()
      .addCheckSuite()
      .addForeignAndLocalCheckRuns()
      .addEmptyCommitStatuses();

    await main.run();

    expect(core.setFailed).toHaveBeenCalled();
  });

  it('does not ignore fork check runs belonging to the evaluated pull request', async () => {
    // a plain fork PR: its own runs carry the PR head branch, so they stay
    // evaluated even with the option enabled
    mockCore.mockInput('ignore-check-runs-from-other-pull-requests', 'true');
    mockGithub()
      .setupContextWithPullRequest({ headRef: 'fork-branch' })
      .addActionRun()
      .addCheckSuite()
      .addForeignAndLocalCheckRuns()
      .addWorkflowRunOrigins()
      .addEmptyCommitStatuses();

    await main.run();

    expect(core.setFailed).toHaveBeenCalled();
  });

  it('does not ignore check runs it cannot attribute to a workflow run', async () => {
    mockCore.mockInput('ignore-check-runs-from-other-pull-requests', 'true');
    mockGithub()
      .setupContextWithPullRequest({ headRef: 'pr-branch' })
      .addActionRun()
      .addCheckSuite()
      .addUnattributableCheckRuns()
      .addEmptyCommitStatuses();

    await main.run();

    expect(core.setFailed).toHaveBeenCalled();
  });

  it('keeps waiting for local checks while foreign runs are ignored', async () => {
    mockCore.mockInput('ignore-check-runs-from-other-pull-requests', 'true');
    mockGithub()
      .setupContextWithPullRequest({ headRef: 'pr-branch' })
      .addActionRun()
      .addCheckSuite({ times: 5 })
      .addForeignAndPendingCheckRuns({ times: 5 })
      .addWorkflowRunOrigins()
      .addEmptyCommitStatuses({ times: 5 });

    await main.run();

    // the retry loop re-evaluates the same foreign run; its origin must be
    // resolved only once (the workflow run API hit is mocked exactly once)
    expect(core.setFailed).toHaveBeenCalledWith(
      '❌ Some checks are still running, but we are not retrying anymore.'
    );
  });
});
