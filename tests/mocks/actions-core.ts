import { jest } from '@jest/globals';

export const mockCore = {
  mockedInputs: new Map<string, string>(),
  resetMockedInputs() {
    this.mockedInputs.clear();
    this.mockInput('github-token', 'Not a token');
  },
  mockInput(name: string, value: string) {
    this.mockedInputs.set(name, value);
  },
  getInput: jest.fn((name: string) => {
    return mockCore.mockedInputs.get(name) || '';
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
