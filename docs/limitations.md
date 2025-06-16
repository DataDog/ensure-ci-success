## Do not set a name for the job running ensure-ci-success

The `ensure-ci-success` action verifies that all jobs in a pull request have completed successfully. However, since it runs as part of the current pull request CI, it must exclude itself from the list of jobs it evaluates.

To do this, it needs to identify itself within the job list returned by the GitHub API. While the workflow run ID is accessible via `GITHUB_RUN_ID`, the numerical job ID of the currently running job is not directly [accessible](https://github.com/orgs/community/discussions/129314).

The only identifier available in the job list response from the API is the job's "name" field. This field is derived as follows:

- If [`job_name`](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_idname) is explicitly set in the job definition, that value is used.
- Otherwise, the [`job_id`](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_id) (the key in the jobs map in the workflow file) is used.
- Crucially, there is no way to determine programmatically which of the two is present in the job list.

On the other hand, the only identifier available within the running job's environment is the `GITHUB_JOB` variable, which always reflects the [`job_id`](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_id).

If you set a custom [`job_name`](https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions#jobsjob_idname) for the job running `ensure-ci-success`, it becomes impossible to reliably match it against entries in the job list, because:

- You can’t determine whether the name or job_id will appear in the API response.
- If the job is not yet listed due to GitHub API lag, it's unclear whether this is because of the delay or because the name mismatch prevents it from being found.

### Mitigation

To ensure reliable self-identification, do not set a name on the job that runs ensure-ci-success, or set it explicitly to match the `job_id`, accompanied by a comment explaining why—so it isn't accidentally changed in the future.

## No Event on Job Retry

GitHub doesn’t provide any event when a job is manually retried. You might think `check_run`, `check_suite`, or `status` events would help — but they only fire on the default branch. That means they won’t show up when working on a pull request branch.

If you retry a job manually, the `ensure-ci-success` job won’t know about it automatically. You’ll have to manually re-run it once all other jobs are finally green. It’s just two clicks, but it can be annoying in CI that have a low probability of success at first run.

### Mitigation

- **Fix flaky jobs**
  This is the real fix. If your jobs are stable, you’ll rarely hit this issue. In fact, some might say this limitation is a subtle nudge to keep your CI healthy.
- **Temporarily ignore flaky jobs**
  Use the ignored-name-patterns input to skip known unreliable jobs. It lowers CI confidence, but if you have a plan to fix them, it’s a reasonable short-term compromise.
- **Don’t use this Action**
  If you prefer, you can add individual "gatekeeper" jobs at the end of each workflow instead of relying on a global check.
