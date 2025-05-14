import * as core from '@actions/core';

export function setFailed(message: string): void {
  core.error(message);
  core.setFailed(message);
}
