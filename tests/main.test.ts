import { jest } from '@jest/globals';
import nock from 'nock';

import { core, mockCore } from './mocks/actions-core';
import { getCheckRun, mockGithub } from './mocks/github';

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

  it.each(['queued', 'in_progress'])(
    'honours a completed success with stale %s status and reports how to rerun it',
    async status => {
      const check = getCheckRun({ id: 42, name: 'actionlint', status });
      mockGithub()
        .setupContextWithPullRequest()
        .addActionRun()
        .addCheckSuite()
        .addCheckRuns([check])
        .addEmptyCommitStatuses();
      const jobs = nock('https://api.github.com')
        .get('/repos/octo-org/example-repo/actions/runs/123/jobs?per_page=100')
        .reply(200, {
          total_count: 2,
          jobs: [
            { id: 456, check_run_url: 'https://api.github.com/repos/other/repo/check-runs/42' },
            { id: 789, check_run_url: check.url },
          ],
        });

      await main.run();

      expect(core.setFailed).not.toHaveBeenCalled();
      expect(jobs.isDone()).toBe(true);
      expect(core.warning).toHaveBeenCalledWith(
        `actionlint has inconsistent GitHub check state: status=${status}, ` +
          'conclusion=success, completed_at=2024-05-12T00:05:00Z. ' +
          'Using conclusion=success because a completion timestamp is present.\n' +
          `${check.html_url}\nTo rerun this job if needed:\n` +
          'gh run rerun 123 --repo octo-org/example-repo --job 789'
      );
      expect(core.info).toHaveBeenCalledWith(
        '✅ All CI checks and statuses passed or were skipped.'
      );
    }
  );

  it.each(['failure', 'cancelled', 'timed_out', 'action_required', 'stale'])(
    'fails on a completed %s conclusion despite an in-progress status',
    async conclusion => {
      mockGithub()
        .setupContextWithPullRequest()
        .addActionRun()
        .addCheckSuite()
        .addCheckRuns([
          getCheckRun({
            name: 'external-ci',
            status: 'in_progress',
            conclusion,
            appSlug: 'circleci',
          }),
        ])
        .addEmptyCommitStatuses();

      await main.run();

      expect(core.setFailed).toHaveBeenCalledWith(
        '❌ Some CI checks or statuses failed, please check the summary table.'
      );
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining(`Using conclusion=${conclusion}`)
      );
      expect(core.warning).not.toHaveBeenCalledWith(expect.stringContaining('gh run rerun'));
    }
  );

  it.each([
    { conclusion: 'success', completed_at: null },
    { conclusion: null, completed_at: '2024-05-12T00:05:00Z' },
    { conclusion: null, completed_at: null },
  ])('keeps waiting with incomplete completion fields: %j', async fields => {
    mockCore.mockInput('max-retries', '1');
    mockGithub()
      .setupContextWithPullRequest()
      .addActionRun()
      .addCheckSuite()
      .addCheckRuns([
        getCheckRun({ name: 'external-ci', status: 'in_progress', appSlug: 'circleci', ...fields }),
      ])
      .addEmptyCommitStatuses();

    await main.run();

    expect(core.setFailed).toHaveBeenCalledWith(
      '❌ Some checks are still running, but we are not retrying anymore.'
    );
    if (fields.conclusion || fields.completed_at) {
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Waiting for both a conclusion and a completion timestamp.')
      );
      expect(core.info).toHaveBeenCalledWith(
        expect.stringContaining(
          `status=in_progress, conclusion=${fields.conclusion}, completed_at=${fields.completed_at}`
        )
      );
    } else {
      expect(core.warning).not.toHaveBeenCalled();
    }
  });

  it.each([403, 200])(
    'preserves the result when the job lookup returns %s without a job',
    async code => {
      mockGithub()
        .setupContextWithPullRequest()
        .addActionRun()
        .addCheckSuite()
        .addCheckRuns([getCheckRun({ name: 'actionlint', status: 'in_progress' })])
        .addEmptyCommitStatuses();
      const jobs = nock('https://api.github.com')
        .get('/repos/octo-org/example-repo/actions/runs/123/jobs?per_page=100')
        .reply(code, code === 200 ? { total_count: 0, jobs: [] } : { message: 'Forbidden' });

      await main.run();

      expect(jobs.isDone()).toBe(true);
      expect(core.setFailed).not.toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledWith(
        expect.stringContaining('Using conclusion=success')
      );
      expect(core.warning).not.toHaveBeenCalledWith(expect.stringContaining('gh run rerun'));
    }
  );

  it.each([200, 403])(
    'shares job lookups within each poll and refreshes after an initial %s response',
    async code => {
      mockCore.mockInput('max-retries', '2');
      const first = [
        getCheckRun({ id: 42, name: 'actionlint', status: 'in_progress' }),
        getCheckRun({ id: 43, name: 'tests', status: 'in_progress' }),
      ];
      const second = [
        getCheckRun({ id: 44, name: 'actionlint', status: 'in_progress' }),
        getCheckRun({ id: 45, name: 'tests', status: 'in_progress' }),
      ];
      const pending = getCheckRun({
        id: 46,
        name: 'pending',
        status: 'in_progress',
        conclusion: null,
        completed_at: null,
      });
      mockGithub()
        .setupContextWithPullRequest()
        .addActionRun()
        .addCheckSuite({ times: 2 })
        .addCheckRuns([...first, pending])
        .addCheckRuns([
          ...second,
          {
            ...pending,
            status: 'completed',
            conclusion: 'success',
            completed_at: '2024-05-12T00:05:00Z',
          },
        ])
        .addEmptyCommitStatuses({ times: 2 });

      const api = nock('https://api.github.com');
      for (const [poll, checks] of [first, second].entries()) {
        const page = api.get('/repos/octo-org/example-repo/actions/runs/123/jobs?per_page=100');
        if (poll === 0 && code === 403) {
          page.reply(403, { message: 'Forbidden' });
          continue;
        }
        const jobs = [
          { id: 700 + poll * 100, check_run_url: checks[0].url },
          ...Array.from({ length: 99 }, (_, i) => ({
            id: i,
            check_run_url: `https://example.com/checks/${i}`,
          })),
          { id: 701 + poll * 100, check_run_url: checks[1].url },
        ];
        page.reply(
          200,
          { total_count: 101, jobs: jobs.slice(0, 100) },
          {
            link: '<https://api.github.com/repos/octo-org/example-repo/actions/runs/123/jobs?per_page=100&page=2>; rel="next"',
          }
        );
        api
          .get('/repos/octo-org/example-repo/actions/runs/123/jobs?per_page=100&page=2')
          .reply(200, { total_count: 101, jobs: jobs.slice(100) });
      }

      await main.run();

      expect(api.isDone()).toBe(true);
      expect(core.setFailed).not.toHaveBeenCalled();
      expect(core.warning).toHaveBeenCalledTimes(4);
      expect(core.warning).toHaveBeenNthCalledWith(3, expect.stringContaining('--job 800'));
      expect(core.warning).toHaveBeenNthCalledWith(4, expect.stringContaining('--job 801'));
      if (code === 200) {
        expect(core.warning).toHaveBeenNthCalledWith(1, expect.stringContaining('--job 700'));
        expect(core.warning).toHaveBeenNthCalledWith(2, expect.stringContaining('--job 701'));
      }
      const failures = mockCore.debug.mock.calls.filter(([message]) =>
        message.includes('Could not resolve a rerun command')
      );
      expect(failures).toHaveLength(code === 403 ? 1 : 0);
    }
  );

  it('warns without a rerun command when the check has no workflow URL', async () => {
    const url = 'https://github.com/octo-org/example-repo/commit/abc123def456/checks/42';
    mockGithub()
      .setupContextWithPullRequest()
      .addActionRun()
      .addCheckSuite()
      .addCheckRuns([getCheckRun({ name: 'actionlint', status: 'in_progress', html_url: url })])
      .addEmptyCommitStatuses();

    await main.run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining(url));
    expect(core.warning).not.toHaveBeenCalledWith(expect.stringContaining('gh run rerun'));
  });

  it('does not warn about inconsistent state for the current or ignored checks', async () => {
    mockCore.mockInput('ignored-name-patterns', 'ignored-job');
    mockGithub()
      .setupContextWithPullRequest()
      .addActionRun()
      .addCheckSuite()
      .addCheckRuns([
        getCheckRun({ id: 2, status: 'in_progress' }),
        getCheckRun({ name: 'ignored-job', status: 'in_progress', conclusion: 'failure' }),
      ])
      .addEmptyCommitStatuses();

    await main.run();

    expect(core.setFailed).not.toHaveBeenCalled();
    expect(core.warning).not.toHaveBeenCalled();
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
