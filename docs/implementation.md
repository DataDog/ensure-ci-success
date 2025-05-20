The first thing to keep in mind is that it takes a pictures of your CI statuses, retries if one of them is running, fails if one of them is failing, and succeed if all of them succeed.

It mean that if the picture totally misses some points, it'll be ignored. The `initial-delay-seconds` helps to limit this risk, but it's a race condition. so it's a good idea to keep some of your important job in the required list of jobs.

Now, let's talk about you implement it in your CI. We'll go threw two different strategies.

## Dedicated workflow

Set this step inside a job, inside a dedicated workflow

## Append at the end of an existing workflow

If your repo got only one workflow, you can simply add a new job in an existing workflow, an plays with `need` parameter to put it at the end of the workflow.

* PRO : does not require an `initial-delay-seconds`, as it runs at the very end
* PRO : automatically retried
* CON : Do not forget to add `if: always()`, as if a previous job fails, or the workflow is cancelled, the job is marked as skipped, which won't block the PR  

## Mixed