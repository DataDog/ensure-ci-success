import { StatusType, CheckRunType } from './types';

export enum Interpretation {
  Success,
  Failure,
  Ignored,
  StillRunning,
  CurrentJob,
}

export class SummaryRow {
  name: string;
  source: 'check run' | 'status';
  status: string;
  interpreted: Interpretation;
  start?: string;
  duration: number | null;
  url: string | null;

  constructor(params: {
    name: string;
    source: 'check run' | 'status';
    status: string;
    interpreted: Interpretation;
    start?: string;
    duration?: number | null;
    url?: string | null;
  }) {
    this.name = params.name;
    this.source = params.source;
    this.status = params.status;
    this.interpreted = params.interpreted;
    this.start = params.start;
    this.duration = params.duration ?? null;
    this.url = params.url ?? null;
  }

  static fromCheck(
    check: CheckRunType,
    ignoredNameRegexps: RegExp[],
    currentJobName: string
  ): SummaryRow {
    const duration =
      check.started_at && check.completed_at
        ? (new Date(check.completed_at).getTime() - new Date(check.started_at).getTime()) / 1000
        : null;

    let interpreted: Interpretation = Interpretation.Failure;
    const status = check.conclusion ?? check.status ?? 'unknown';

    if (check.name === currentJobName && check.app?.slug === 'github-actions') {
      interpreted = Interpretation.CurrentJob;
    } else if (ignoredNameRegexps.some(regex => regex.test(check.name))) {
      interpreted = Interpretation.Ignored;
    } else if (check.status === 'queued' || check.status === 'in_progress') {
      interpreted = Interpretation.StillRunning;
    } else if (['success', 'skipped', 'neutral'].includes(check.conclusion || '')) {
      interpreted = Interpretation.Success;
    } else {
      interpreted = Interpretation.Failure;
    }

    return new SummaryRow({
      name: check.name,
      source: 'check run',
      status,
      start: check.started_at ?? undefined,
      duration,
      url: check.html_url ?? null,
      interpreted,
    });
  }

  static fromStatus(status: StatusType, ignoredNameRegexps: RegExp[]): SummaryRow {
    const duration =
      status.updated_at && status.created_at
        ? (new Date(status.updated_at).getTime() - new Date(status.created_at).getTime()) / 1000
        : null;

    let interpreted: Interpretation = Interpretation.Failure;

    if (ignoredNameRegexps.some(regex => regex.test(status.context))) {
      interpreted = Interpretation.Ignored;
    } else if (status.state === 'pending') {
      interpreted = Interpretation.StillRunning;
    } else if (status.state !== 'success') {
      interpreted = Interpretation.Failure;
    } else {
      interpreted = Interpretation.Success;
    }

    const row = new SummaryRow({
      name: status.context,
      source: 'status',
      status: status.state,
      start: status.created_at,
      duration,
      url: status.target_url ?? null,
      interpreted,
    });

    return row;
  }
}
