import { GetResponseDataTypeFromEndpointMethod } from '@octokit/types';
import * as github from '@actions/github';

export type OctokitType = ReturnType<typeof github.getOctokit>;

export type StatusesType = GetResponseDataTypeFromEndpointMethod<
  OctokitType['rest']['repos']['getCombinedStatusForRef']
>['statuses'];
export type StatusType = StatusesType[number];

export type CheckRunsType = GetResponseDataTypeFromEndpointMethod<
  OctokitType['rest']['checks']['listForRef']
>['check_runs'];
export type CheckRunType = CheckRunsType[number];
