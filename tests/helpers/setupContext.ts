import * as github from '@actions/github';
import { jest } from '@jest/globals';

const context = {
  runId: 123,
  job: 'ensure-ci-success',
  repo: {
    owner: 'octo-org',
    repo: 'example-repo',
  },
  payload: {
    pull_request: {
      number: 42,
      head: {
        sha: 'abc123def456',
      },
    },
  },
};

jest.mock('@actions/github', () => {
  // process.env.GITHUB_JOB = 'ensure-ci-success';
  // process.env.GITHUB_RUN_ID = '123';
  // process.env.GITHUB_REPOSITORY = 'octo-org/example-repo';
  // process.env.GITHUB_EVENT_PATH = path.join(__dirname, 'context.json');

  const originalModule = jest.requireActual<typeof github>('@actions/github');
  return {
    ...originalModule,
    context: context,
  };
});

export function setupGitHubContext() {}
