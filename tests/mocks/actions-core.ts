import { jest } from '@jest/globals';

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
export const core = await import('@actions/core');
