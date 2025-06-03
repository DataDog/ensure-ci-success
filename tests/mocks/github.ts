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

  public setupContextWithPullRequest() {
    context.payload = {
      pull_request: {
        number: 42,
        head: {
          sha: 'abc123def456',
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

  public addCheckSuite() {
    this.scope
      .get('/repos/octo-org/example-repo/commits/abc123def456/check-suites?per_page=100')
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

  public addEmptyCommitStatuses() {
    this.scope
      .get('/repos/octo-org/example-repo/commits/abc123def456/status?per_page=100&page=1')
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
    status: null,
    conclusion: null,
    name: '',
    run_number: 0,
    run_attempt: run_attempt,
    event: '',
    actor: getActor(),
    repository: getRepository(),
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
}: { id?: number; name?: string; conclusion?: string } = {}) {
  return {
    id: id,
    name: name,
    head_sha: 'abc123def456',
    status: 'completed',
    conclusion: conclusion,
    started_at: '2024-05-12T00:00:00Z',
    completed_at: '2024-05-12T00:05:00Z',
    app: {
      id: 15368,
      slug: 'github-actions',
      name: 'GitHub Actions',
    },
  };
}
