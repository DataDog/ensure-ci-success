import * as github from '@actions/github';
import { jest } from '@jest/globals';
import nock from 'nock';

const context = {
  runId: 123,
  job: 'ensure-ci-success',
  repo: {
    owner: 'octo-org',
    repo: 'example-repo',
  },
  payload: {},
  sha: 'abc123def456',
};

jest.mock('@actions/github', () => {
  const originalModule = jest.requireActual<typeof github>('@actions/github');
  return {
    ...originalModule,
    context: context,
  };
});

export class MockGitHub {
  private scope: nock.Scope;
  constructor() {
    this.scope = nock('https://api.github.com');
  }

  public setInput(name: string, value: string) {
    process.env[`INPUT_${name.replace(/ /g, '_').toUpperCase()}`] = value;
    return this;
  }

  public setupContextWithPullRequest({ headRef = 'pr-branch' }: { headRef?: string } = {}) {
    context.payload = {
      pull_request: {
        number: 42,
        head: {
          sha: 'abc123def456',
          ref: headRef,
        },
      },
    };
    return this;
  }

  public setupContextWithoutPullRequest() {
    context.payload = {};

    return this;
  }

  public addActionRun({ run_attempt = 1 }: { run_attempt?: number } = {}) {
    this.scope
      .get('/repos/octo-org/example-repo/actions/runs/123')
      .reply(200, getActionRun({ run_attempt }));

    return this;
  }

  public addCheckSuite({ times = 1 }: { times?: number } = {}) {
    this.scope
      .get('/repos/octo-org/example-repo/commits/abc123def456/check-suites?per_page=100')
      .times(times)
      .reply(200, {
        total_count: 1,
        check_suites: [getCheckSuite(), getCheckSuite({ id: 666, latest_check_runs_count: 0 })],
      });

    return this;
  }

  public addCheckRun() {
    this.scope
      .get('/repos/octo-org/example-repo/check-suites/1234567890/check-runs?per_page=100')
      .reply(200, {
        total_count: 3,
        check_runs: [
          getCheckRun(), // current job
          getCheckRun({ name: '${{ not interpolated }}', conclusion: 'failure' }),
          getCheckRun({ id: 1, name: 'some-job', conclusion: 'failure' }),
          getCheckRun({ id: 2, name: 'some-job', conclusion: 'success' }),
          getCheckRun({ name: 'ignored-job', conclusion: 'failure' }),
        ],
      });

    return this;
  }

  public addFailedCheckRun() {
    this.scope
      .get('/repos/octo-org/example-repo/check-suites/1234567890/check-runs?per_page=100')
      .reply(200, {
        total_count: 3,
        check_runs: [
          getCheckRun(), // current job
          getCheckRun({ name: '${{ not interpolated }}', conclusion: 'failure' }),
          getCheckRun({ id: 1, name: 'failed-job', conclusion: 'failure' }),
          getCheckRun({ name: 'ignored-job', conclusion: 'failure' }),
        ],
      });

    return this;
  }

  /**
   * Simulates a commit shared by a fork PR and an in-repo PR: the suite
   * carries a failing run from the fork and a successful run from the
   * repository, both named 'some-job'.
   */
  public addForeignAndLocalCheckRuns() {
    this.scope
      .get('/repos/octo-org/example-repo/check-suites/1234567890/check-runs?per_page=100')
      .reply(200, {
        total_count: 2,
        check_runs: [
          getCheckRun(), // current job
          getCheckRun({
            id: 7,
            name: 'some-job',
            conclusion: 'failure',
            html_url: 'https://github.com/octo-org/example-repo/actions/runs/999/job/1000',
          }),
          getCheckRun({
            id: 2,
            name: 'some-job',
            conclusion: 'success',
            html_url: 'https://github.com/octo-org/example-repo/actions/runs/1001/job/1002',
          }),
        ],
      });

    return this;
  }

  /** Declares where mocked workflow runs 999 (fork) and 1001 (repository) ran. */
  public addWorkflowRunOrigins() {
    this.scope.get('/repos/octo-org/example-repo/actions/runs/999').reply(200, {
      ...getActionRun(),
      id: 999,
      head_branch: 'fork-branch',
      head_repository: { ...getRepository(), full_name: 'forker/example-repo' },
    });
    this.scope.get('/repos/octo-org/example-repo/actions/runs/1001').reply(200, {
      ...getActionRun(),
      id: 1001,
      head_branch: 'pr-branch',
      head_repository: getRepository(),
    });

    return this;
  }

  /** Check runs the action cannot attribute to a workflow run. */
  public addUnattributableCheckRuns() {
    this.scope
      .get('/repos/octo-org/example-repo/check-suites/1234567890/check-runs?per_page=100')
      .reply(200, {
        total_count: 3,
        check_runs: [
          getCheckRun(), // current job
          // third-party app: no workflow run to resolve
          getCheckRun({
            id: 3,
            name: 'external-ci',
            conclusion: 'failure',
            appSlug: 'circleci',
            html_url: 'https://circleci.com/gh/octo-org/example-repo/42',
          }),
          // GitHub Actions run whose URL carries no workflow run id
          getCheckRun({
            id: 4,
            name: 'mystery-job',
            conclusion: 'failure',
            html_url: 'https://github.com/octo-org/example-repo/commit/abc123def456/checks/4',
          }),
        ],
      });

    return this;
  }

  /** A foreign failing run plus a local run that is still in progress. */
  public addForeignAndPendingCheckRuns({ times = 1 }: { times?: number } = {}) {
    this.scope
      .get('/repos/octo-org/example-repo/check-suites/1234567890/check-runs?per_page=100')
      .times(times)
      .reply(200, {
        total_count: 3,
        check_runs: [
          getCheckRun(), // current job
          getCheckRun({
            id: 7,
            name: 'some-job',
            conclusion: 'failure',
            html_url: 'https://github.com/octo-org/example-repo/actions/runs/999/job/1000',
          }),
          getCheckRun({
            id: 8,
            name: 'pending-job',
            conclusion: null,
            status: 'in_progress',
            html_url: 'https://github.com/octo-org/example-repo/actions/runs/1001/job/1003',
          }),
        ],
      });

    return this;
  }

  public addFailedStatus() {
    this.scope
      .get('/repos/octo-org/example-repo/commits/abc123def456/status?per_page=100&page=1')
      .reply(200, {
        statuses: [
          getCommitStatus({ context: 'failed-status', state: 'failure' }),
          getCommitStatus({ context: 'good-status', state: 'success' }),
        ],
        total_count: 2,
      });
    return this;
  }

  public addEmptyCommitStatuses({ times = 1 }: { times?: number } = {}) {
    this.scope
      .get('/repos/octo-org/example-repo/commits/abc123def456/status?per_page=100&page=1')
      .times(times)
      .reply(200, {
        statuses: [],
        total_count: 0,
      });

    return this;
  }
}

export function mockGithub(): MockGitHub {
  return new MockGitHub();
}

export function getActor() {
  return {
    login: '',
    id: 0,
    type: '',
  };
}

export function getRepository() {
  return {
    id: 0,
    name: 'example-repo',
    full_name: 'octo-org/example-repo',
    owner: {
      login: 'octo-org',
      id: 0,
      type: 'Organization',
    },
    private: false,
  };
}

export function getActionRun({ run_attempt = 1 }: { run_attempt?: number } = {}) {
  return {
    id: 123,
    head_sha: '',
    head_branch: 'main',
    status: null,
    conclusion: null,
    name: '',
    run_number: 0,
    run_attempt: run_attempt,
    event: '',
    actor: getActor(),
    repository: getRepository(),
    head_repository: getRepository(),
    created_at: null,
    updated_at: null,
  };
}

export function getCheckSuite({
  id = 1234567890,
  latest_check_runs_count = 1,
}: { id?: number; latest_check_runs_count?: number } = {}) {
  return {
    id: id,
    head_sha: '',
    status: 'completed',
    conclusion: 'success',
    latest_check_runs_count: latest_check_runs_count,
    url: 'https://api.github.com/repos/github/hello-world/check-suites/5',
    app: {
      id: 15368,
      slug: 'github-actions',
      name: 'GitHub Actions',
    },
    created_at: null,
    updated_at: null,
  };
}

export function getCheckRun({
  id = 1,
  name = 'ensure-ci-success',
  conclusion = 'success',
  status = 'completed',
  appSlug = 'github-actions',
  html_url = 'https://github.com/octo-org/example-repo/actions/runs/123/job/456',
}: {
  id?: number;
  name?: string;
  conclusion?: string | null;
  status?: string;
  appSlug?: string;
  html_url?: string;
} = {}) {
  return {
    id: id,
    name: name,
    head_sha: 'abc123def456',
    status: status,
    conclusion: conclusion,
    started_at: '2024-05-12T00:00:00Z',
    completed_at: '2024-05-12T00:05:00Z',
    html_url: html_url,
    app: {
      id: 15368,
      slug: appSlug,
      name: appSlug,
    },
  };
}

export function getCommitStatus({
  id = 1,
  context = 'ci/some-ci',
  state = 'success',
}: { id?: number; context?: string; state?: string } = {}) {
  return {
    url: 'https://api.github.com/repos/octocat/Hello-World/statuses/6dcb09b5b57875f334f61aebed695e2e4193db5e',
    avatar_url: 'https://github.com/images/error/hubot_happy.gif',
    id: id,
    node_id: 'MDY6U3RhdHVzMQ==',
    state: state,
    description: 'Build has completed successfully',
    target_url: 'https://ci.example.com/1000/output',
    context: context,
    created_at: '2012-07-20T01:19:13Z',
    updated_at: '2012-07-20T01:19:13Z',
  };
}
