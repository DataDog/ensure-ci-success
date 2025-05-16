import { jest } from '@jest/globals';

const mockCore = {
  getInput: jest.fn(name => {
    if (name === 'ignored-name-patterns') {
      return 'ignored-job';
    } else if (name === 'github-token') {
      return 'Not a token';
    } else {
      return '';
    }
  }),
  setOutput: jest.fn(),
  setFailed: jest.fn(),
  error: jest.fn((message: string) => {
    console.log(`${new Date().toLocaleTimeString()} [ERROR] ${message}`);
  }),
  warning: jest.fn((message: string) => {
    console.log(`${new Date().toLocaleTimeString()} [WARN] ${message}`);
  }),
  info: jest.fn((message: string) => {
    console.log(`${new Date().toLocaleTimeString()}] [INFO] ${message}`);
  }),
  debug: jest.fn((message: string) => {
    console.log(`${new Date().toLocaleTimeString()} [DEBUG] ${message}`);
  }),
};

jest.unstable_mockModule('@actions/core', () => mockCore);
export const core = await import('@actions/core');
