import nock from 'nock';

export class MockGitHubApi {
  private scope: nock.Scope;
  constructor() {
    this.scope = nock('https://api.github.com');
  }

  public addActionRun() {
    this.scope.get('/repos/octo-org/example-repo/actions/runs/123').reply(200, getActionRun());

    return this;
  }

  public addCheckSuite() {
    this.scope
      .get('/repos/octo-org/example-repo/commits/abc123def456/check-suites?per_page=100')
      .reply(200, {
        total_count: 1,
        check_suites: [getCheckSuite()],
      });

    return this;
  }

  public addCheckRun() {
    this.scope
      .get('/repos/octo-org/example-repo/check-suites/1234567890/check-runs?per_page=100')
      .reply(200, {
        total_count: 1,
        check_runs: [getCheckRun()],
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

export function mockGithubApi(): MockGitHubApi {
  return new MockGitHubApi();
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

export function getActionRun() {
  return {
    id: 123,
    head_sha: '',
    status: null,
    conclusion: null,
    name: '',
    run_number: 0,
    run_attempt: 1,
    event: '',
    actor: getActor(),
    repository: getRepository(),
    created_at: null,
    updated_at: null,
  };
}

export function getCheckSuite() {
  return {
    id: 1234567890,
    head_sha: '',
    status: 'completed',
    conclusion: 'success',
    app: {
      id: 15368,
      slug: 'github-actions',
      name: 'GitHub Actions',
    },
    created_at: null,
    updated_at: null,
  };
}

export function getCheckRun() {
  return {
    id: 987654321,
    name: 'ensure-ci-success',
    head_sha: 'abc123def456',
    status: 'completed',
    conclusion: 'success',
    started_at: '2024-05-12T00:00:00Z',
    completed_at: '2024-05-12T00:05:00Z',
    app: {
      id: 15368,
      slug: 'github-actions',
      name: 'GitHub Actions',
    },
  };
}
