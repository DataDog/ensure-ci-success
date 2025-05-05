import { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';
import { Octokit } from '@octokit/rest';

export type StatusesType = GetResponseDataTypeFromEndpointMethod<
  Octokit['rest']['repos']['getCombinedStatusForRef']
>['statuses'];
export type StatusType = StatusesType[number];

export type CheckRunsType = GetResponseDataTypeFromEndpointMethod<
  Octokit['rest']['checks']['listForRef']
>['check_runs'];
export type CheckRunType = CheckRunsType[number];
