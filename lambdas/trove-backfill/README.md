# trove-backfill (Lambda / Step Functions PoC)

An independent alternative to `trove-backfill-ecs`. The CAPI and SQS code is
deliberately duplicated so the ECS app and its CDK resources can be removed
without changing this implementation.

Start the `trove-backfill-<STAGE>` Standard Step Function with:

```json
{ "fromDate": "2020-01-01", "toDate": "2020-12-31" }
```

Both date bounds are required. Each Lambda invocation fetches up to ten pages of
200 articles/liveblogs, oldest-first, and sends embedding events to the existing
backfill queue. The first page uses CAPI `/search`; later pages use
`/content/{lastSeenId}/next`, including across Lambda invocations. A short or empty
page completes the execution.

The Lambda checks queue depth before each page. At 10,000 queued messages it
returns immediately; Step Functions waits 30 seconds before invoking it again.
It also returns early when less than two minutes remain of its five-minute
timeout, leaving time to finish the current page. Otherwise, the next batch
starts immediately.

State contains the date bounds, `lastSeenId`, `lastSeenWebPublicationDate` and
cumulative `pages`, `sent` and `skipped` counters. Progress is logged after each
successfully enqueued page. Task failures are retried with backoff; a retry may
re-enqueue articles from the same batch, relying on idempotent embedding updates.
Counters describe successful batches, not unique queue deliveries.

To resume a stopped or failed execution, use the last successful task output as
the next execution's input (or a logged page checkpoint). Alternatively, use its
`lastSeenWebPublicationDate` as `fromDate` to replay from that publication date.
Stopping the execution does not cancel an already-running Lambda invocation.

Executions time out after seven days. There is deliberately no automatic
execution rollover: very large backfills or prolonged queue waits can reach
Step Functions' 25,000-event execution-history limit. Split date ranges or resume
from a checkpoint when needed. Both approaches share the backfill queue, so run
them separately for comparisons.

## Deployment

Create the SSM SecureString
`/<STAGE>/content-api/trove-backfill/capi-api-key` with the CAPI API key.
This is separate from the ECS parameter. CDK grants the Lambda read access and
sets `CAPI_API_KEY_PARAMETER_NAME` and `BACKFILL_EMBEDDER_QUEUE_URL`.
`CAPI_URL` optionally overrides `https://content.guardianapis.com`.

The existing CI packaging and Riff-Raff configuration deploy this Lambda as
`trove-backfill`, using `lambdas/trove-backfill/dist/trove-backfill.zip`.
