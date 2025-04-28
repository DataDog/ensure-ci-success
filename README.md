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

jobs:
  ensure-ci-success:
    name: Ensure all CI checks passed

    steps:
      - name: Run Ensure CI Success
        uses: DataDog/ensure-ci-success@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

And the only final step is to make this job a requirements for merges using branch protection rules.