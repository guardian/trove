# Backfill ADR

This document describes how Trove traverses historical CAPI content and runs a backfill.

# Context

The backfill needs to send all historical CAPI content through the embedding pipeline. This is a large, long-running process, so it must be resumable after a failure without starting again from the beginning.

CAPI needs a careful pagination strategy as there can be more than 200 articles with the same exact date, exceeding the maximum number of articles per page. This can lead to infinite loops if implemented naively.

# Decisions

These decisions were made on 12 November 2026.

## Decision: Use CAPI's `/next` endpoint for pagination

Each backfill uses one stable CAPI query. Every request after the first includes the CAPI ID of the last item seen, allowing CAPI to continue from the previous page using its underlying `search_after` behaviour.

The backfill stores its cursor outside the running task. It can therefore resume from the last completed page after a restart rather than re-reading all previously processed content.

**Reasoning**:

- The cursor avoids the problems caused by clusters of more than 200 articles.
- It maps directly to CAPI's pagination support and avoids implementing date ranges in Trove.
- The query remains constant across a run, so the only page state that needs to persist is the last seen CAPI ID.

**Alternative**: Build a list of days to extract, then paginate through each day separately.

BUT - that splits the pagination logic across date and page boundaries. The `/next` endpoint provides a simpler, continuous traversal.

## Decision: Run the backfill as an ECS Fargate task

The backfill task uses an imperative loop to request a page from CAPI, enqueue its content and checkpoint its progress. The task is triggered and monitored through the Guardian CDK `GuEcsTask` construct.

Its progress is stored outside ECS so that a restarted task can continue from the last persisted cursor.

**Reasoning**:

- Fargate has no short execution-time limit, so pagination can run without splitting a single backfill across many invocations.
- The task's local execution is close to its production execution, making development and debugging simpler.
- Fargate gives us practical experience with the container-based infrastructure being adopted within P&E.
- `GuEcsTask` provides a simple way to trigger the task and alarm when it fails.

**Alternative**: Use a Step Function containing one or more Lambdas.

Step Functions provide retries, backoff and state management declaratively, and the expected number of transitions and runtime are within the service limits. A Lambda invocation would need to be safe to retry in full.

BUT - running and debugging the workflow locally would be less representative of production. Fargate offers a simpler execution model while still being a viable way to run the process.

**Alternative**: Run a scheduled Lambda and store progress in DynamoDB.

This could use one row per backfill to hold the last seen CAPI ID, with each invocation processing the next page.

BUT - it would require Trove to implement scheduling, retry and resumability behaviour itself. An always-enabled schedule would also be unnecessary outside backfill runs.

**Consequences**:

- The task must persist its cursor and checkpoint only after the current page has been safely handed to the embedding pipeline.
- A failure after enqueueing but before checkpointing may replay the same content, so the pipeline must tolerate duplicate work.
- Retry and resumability behaviour must be implemented in the task.
- Trove must build and maintain an additional container image.
- A Step Function remains a viable fallback if ECS introduces an implementation blocker.
