# Ensure CI Success

[![CI](https://github.com/DataDog/ensure-ci-success/actions/workflows/ci.yml/badge.svg)](https://github.com/DataDog/ensure-ci-success/actions/workflows/ci.yml)

🔒 A GitHub Action that ensures **all CI checks and commit statuses** on a Pull Request have **passed** or been **skipped**.

---

## Why?

This Action acts as a **gatekeeper** for CI pipelines, allowing you to enable a Green CI Policy on your pull requests or push events.

It checks that all workflows, checks, and commit statuses associated with a commit sha **succeed or are skipped**, ensuring PRs don't merge with failing CI.

---

## Usage

```yml
name: Check Pull Request CI Status

on:
  pull_request:
    types:
      - opened
      - synchronize
      - reopened

permissions:
  actions: read
  checks: read
  statuses: read

jobs:
  ensure-ci-success:
    runs-on: ubuntu-latest
    steps:
      - name: Run Ensure CI Success
        uses: DataDog/ensure-ci-success@v2
```

The final step is to make this job a requirement for merges using branch protection rules.

It's a good practice to set this job as a final job in your pipeline using the `needs` parameter, to limit useless CPU time.
However, if you do so, any failure will prevent this last job from running, and the GitHub PR engine does not account it as failed.
So do not forget to add the parameter `if: '!cancelled()'`; it will force the job to run unless it's explicitly cancelled.

## Inputs

| Name                       | Default               |                             Description                              |
| :------------------------- | :-------------------- | :------------------------------------------------------------------: |
| `github-token`             | `${{ github.token }}` |                    GitHub token to access the API                    |
| `ignored-name-patterns`    | (empty)               | List of regular expressions to ignore specific check or status names |
| `initial-delay-seconds`    | `5`                   |       Number of seconds to wait before the first check starts        |
| `max-retries`              | `5`                   |    Maximum number of retries while waiting for checks to complete    |
| `polling-interval-seconds` | `60`                  |              Number of seconds to wait between retries               |

```yml
steps:
  - name: Run Ensure CI Success
    uses: DataDog/ensure-ci-success@v2
    with:
      initial-delay-seconds: 60 # Wait 60 seconds before starting
      max-retries: 10 # Retries 10 times
      polling-interval-seconds: 60 # Wait 60s between each try
      ignored-name-patterns: |
        some-flaky-job
        gitlab.*
```

## Limitations

- Don't set a `job_name` to the job running this action (see why [here](docs/limitations.md))
- Don't use the same name for another job (for the same reason)
- If a job starts **after** the current job has already completed, it will not be processed. The `initial-delay-seconds` parameter helps reduce the likelihood of this issue but does not eliminate it entirely. You can also add a long-running job as a dependency for the job performing this action — just remember to include `if: always()` to ensure it isn't skipped. In all cases, make sure to carefully read the documentation about [implementation strategies](docs/implementation.md).

---

Note: This project exists to address a [known GitHub limitation](https://github.com/orgs/community/discussions/26733): by default, GitHub allows pull requests to be merged even when some CI checks fail.

While it's possible to enforce a green CI policy using GitHub's native "required status checks" feature, doing so requires explicitly listing all job names under branch protection rules. This approach has two key drawbacks:

- It does not support optional jobs
- It introduces ongoing maintenance overhead as the job list evolves

This project provides a flexible and maintainable alternative. Ideally, GitHub will eventually support native enforcement of successful CI completion across all jobs. If and when that happens, this project may become obsolete and will be archived accordingly.
