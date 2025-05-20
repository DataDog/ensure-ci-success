The first thing to understand is how the action works: it takes a snapshot of your CI statuses, retries if any are still running, fails if any have failed, and succeeds only if all have succeeded.

This means that if some statuses are missing at the time of the snapshot, they’ll simply be ignored. You can reduce the chance of this happening by configuring `initial-delay-seconds`, but it's still fundamentally a race condition. To mitigate this, it's a good idea to include your most critical jobs in the required checks list.

Now, let’s look at how you can integrate the action into your CI setup. There are two main strategies:

## Dedicated workflow

Add the action as a step in a job inside a separate, dedicated workflow.

- PRO: Keeps things clean, especially if you have many workflows.
- CON: Requires manually triggering a retry if needed.
- CON: You must configure an appropriate `initial-delay-seconds`, which can be tricky to get right.

## Appended to an existing Workflow

If your repository has only one main workflow, you can simply append a new job at the end of it using the `needs` keyword.

- PRO: No need to configure `initial-delay-seconds`, since it runs last by design.
- PRO: Will automatically be included in workflow retries.
- CON: Be sure to add `if: always()` or `if: !cancelled()` to the job. Otherwise, if a previous job fails, this job will be skipped — and GitHub will consider the check as passed, allowing the PR to be merged even though other jobs failed.

## Hybrid approach

You can also mix the two strategies—for example, by appending the job to one of several workflows in your repository.
