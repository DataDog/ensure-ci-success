import path from 'path';
import { jest } from '@jest/globals';
import nock from 'nock';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const mockCore = {
  getInput: jest.fn(name => {
    return name == 'github-token' ? 'token' : '';
  }),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  info: jest.fn((message: string) => {
    console.log(`info [${new Date().toLocaleTimeString()}]: ${message}`);
  }),
  error: jest.fn((message: string) => {
    console.log(`error [${new Date().toLocaleTimeString()}]: ${message}`);
  }),
  warning: jest.fn((message: string) => {
    console.log(`warning [${new Date().toLocaleTimeString()}]: ${message}`);
  }),
};

jest.unstable_mockModule('@actions/core', () => mockCore);

const realSetTimeOut = global.setTimeout;

describe('ensure-ci-success functional test', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.clearAllTimers();

    global.setTimeout = jest.fn((cb: () => void) => {
      cb();
      return 0 as unknown as NodeJS.Timeout;
    }) as unknown as typeof setTimeout;

    process.env.GITHUB_JOB = 'ensure-ci-success';
    process.env.GITHUB_RUN_ID = '123';
    process.env.GITHUB_REPOSITORY = 'octo-org/example-repo';
    process.env.GITHUB_EVENT_PATH = path.join(__dirname, 'context.json');

    nock.cleanAll(); // ensure a clean slate
    nock.disableNetConnect(); // prevent real HTTP calls
    nock('https://api.github.com')
      .get('/repos/octo-org/example-repo/actions/runs/123')
      .reply(200, {
        id: 123,
        head_sha: '',
        status: null,
        conclusion: null,
        name: '',
        run_number: 0,
        run_attempt: 1,
        event: '',
        actor: {
          login: '',
          id: 0,
          type: '',
        },
        repository: {
          id: 0,
          name: 'example-repo',
          full_name: 'octo-org/example-repo',
          owner: {
            login: 'octo-org',
            id: 0,
            type: 'Organization',
          },
          private: false,
        },
        created_at: null,
        updated_at: null,
      })
      .get('/repos/octo-org/example-repo/commits/abc123def456/check-suites?per_page=100')
      .reply(200, {
        total_count: 1,
        check_suites: [
          {
            id: 1234567890,
            head_sha: 'abc123def456',
            status: 'completed',
            conclusion: 'success',
            app: {
              id: 15368,
              slug: 'github-actions',
              name: 'GitHub Actions',
            },
            created_at: '2024-05-12T00:00:00Z',
            updated_at: '2024-05-12T00:00:00Z',
          },
        ],
      })
      .get('/repos/octo-org/example-repo/check-suites/1234567890/check-runs?per_page=100')
      .reply(200, {
        total_count: 1,
        check_runs: [
          {
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
          },
        ],
      })
      .get('/repos/octo-org/example-repo/commits/abc123def456/status?per_page=100&page=1')
      .reply(200, {
        statuses: [],
        total_count: 0,
      });
  });

  afterEach(() => {
    global.setTimeout = realSetTimeOut;
    nock.enableNetConnect();
  });

  it('outputs success=true if all jobs succeed', async () => {
    const main = await import('../src/main');
    const core = await import('@actions/core');

    await main.run();

    expect(core.setFailed).not.toHaveBeenCalled();
  });
});
