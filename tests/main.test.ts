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
});
