# Ensure CI Success

[![CI](https://github.com/DataDog/ensure-ci-success/actions/workflows/ci.yml/badge.svg)](https://github.com/DataDog/ensure-ci-success/actions/workflows/ci.yml)

🔒 A GitHub Action that ensures **all CI checks and commit statuses** on a Pull Request have **passed** or been **skipped**.

---

## Why?

This Action acts as a **gatekeeper** for CI pipelines, allowing to enable a Green CI Policy on your pull requests.

It checks that all workflows, checks, and commit statuses associated with a PR **succeed or are skipped**, ensuring PRs don't merge with failing CI.

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
  checks: read
  statuses: read

jobs:
  ensure-ci-success:
    name: Ensure all CI checks passed

    steps:
      - name: Run Ensure CI Success
        uses: DataDog/ensure-ci-success@v1
```

It's a good practice to set this job as a final job in your pipeline using `needs` parameter, to limit useless CPU time.

The final step is to make this job a requirements for merges using branch protection rules.

## Inputs

| Name                       | Default               |                             Description                              |
| :------------------------- | :-------------------- | :------------------------------------------------------------------: |
| `github-token`             | `${{ github.token }}` |                    GitHub token to access the API                    |
| `ignored-name-patterns`    | (empty)               | List of regular expressions to ignore specific check or status names |
| `initial-delay-seconds`    | `0`                   |       Number of seconds to wait before the first check starts        |
| `max-retries`              | `5`                   |    Maximum number of retries while waiting for checks to complete    |
| `polling-interval-seconds` | `60`                  |              Number of seconds to wait between retries               |

```yml
steps:
  - name: Run Ensure CI Success
    uses: DataDog/ensure-ci-success@v1
    with:
      initial-delay-seconds: 60 # Wait 60 seconds before starting
      max-retries: 10 # Retries 10 times
      polling-interval-seconds: 60 # Wait 60s between each try
      ignored-name-patterns: |
        some-flaky-job
        gitlab.*
```

## Limitations

* Don't set a `name` to the job running this action, github does not offer a reliable way to identify the current job.

----

Note: This project exists to address a [known Github limitation](https://github.com/orgs/community/discussions/26733): by default, GitHub allows pull requests to be merged even when some CI checks fail.

While it's possible to enforce a green CI policy using GitHub's native "required status checks" feature, doing so requires explicitly listing all job names under branch protection rules. This approach has two key drawbacks:

* It does not support optional jobs
* It introduces ongoing maintenance overhead as the job list evolves

This project provides a flexible and maintainable alternative. Ideally, GitHub will eventually support native enforcement of successful CI completion across all jobs. If and when that happens, this project may become obsolete and will be archived accordingly.