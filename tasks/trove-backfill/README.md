# trove-backfill

Runs the historical backfill as a long-running ECS Fargate task.

It pages through CAPI oldest-first and sends an `UpdateEmbeddingEvent` for each article/liveblog to the backfill
queue, where the embedder picks it up. The first page comes from `/search`. Every later page comes from
`/content/{lastSeenId}/next` (see [content-api#2812](https://github.com/guardian/content-api/pull/2812)).

For now it deliberately sends only a few pages (`MAX_PAGES` × `PAGE_SIZE` in `src/index.ts`), so a run demonstrates the
whole pipeline (backfill → queue → embedder logs) without flooding the queue. There is no back-pressure, retry or
resume yet.

## Running locally

```sh
# Without Docker
DRY_RUN=true CAPI_API_KEY=… FROM_DATE=2020-01-01 TO_DATE=2020-01-02 npm start -w trove-backfill

# With Docker (build from the repo root)
docker build -f tasks/trove-backfill/Dockerfile -t trove-backfill .
docker run --rm --read-only -e DRY_RUN=true -e CAPI_API_KEY=… -e FROM_DATE=2020-01-01 trove-backfill
```

| Env var                       | Default                            |                                         |
| ----------------------------- | ---------------------------------- | --------------------------------------- |
| `CAPI_API_KEY`                | required                           | Read from SSM by ECS in AWS             |
| `BACKFILL_EMBEDDER_QUEUE_URL` | required unless `DRY_RUN=true`     | Set by CDK                              |
| `FROM_DATE` / `TO_DATE`       | unbounded                          | Set from the Step Function input in AWS |
| `CAPI_URL`                    | `https://content.guardianapis.com` |                                         |
| `DRY_RUN`                     | `false`                            | Logs instead of sending to SQS          |

## Build and deploy

1. CI (`backfill-image` job) builds the ARM64 image and pushes it to the central ECR repository
   `guardian/trove/trove-backfill` with [`guardian/actions-ecr`](https://github.com/guardian/actions-ecr).
2. The image digest is passed to `cdk synth` as `IMAGE_DIGEST`, which pins it in the task definition.
3. Riff-Raff's normal `cloud-formation` deployment updates the task definition. There's no separate artifact
   upload step.

To run a backfill, start an execution of the `trove-backfill-<STAGE>` Step Function (created by `GuEcsTask`):

```json
{ "fromDate": "2020-01-01", "toDate": "2020-12-31" }
```

Both keys are required. Shard by date range by starting several executions.

### Prerequisites before this can deploy

- The ECR repository `guardian/trove/trove-backfill` must exist, and the repo needs a `GU_ARTIFACTS_ROLE_ARN`
  secret with push access. Both are set up in [guardian/riffraff-platform](https://github.com/guardian/riffraff-platform).
- The SSM SecureString `/<STAGE>/content-api/trove-backfill/capi-api-key` must exist.
