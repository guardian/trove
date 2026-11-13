# trove-backfill

Runs the historical backfill as a long-running ECS Fargate task.

For now it just sends 10 dummy `UpdateEmbeddingEvent`s to the backfill queue, so we can see them come out of the
embedder logs. Paging through CAPI (using `/content/{lastSeenId}/next`, see
[content-api#2812](https://github.com/guardian/content-api/pull/2812)) comes next. The `CAPI_API_KEY` secret is
already wired up in CDK for that.

## Running locally

Needs AWS credentials that can send to the queue.

```sh
BACKFILL_EMBEDDER_QUEUE_URL=… npm start -w trove-backfill
```

## Build and deploy

1. CI (`backfill-image` job) builds the ARM64 image and pushes it to the central ECR repository
   `guardian/trove/trove-backfill` with [`guardian/actions-ecr`](https://github.com/guardian/actions-ecr).
2. The image digest is passed to `cdk synth` as `IMAGE_DIGEST`, which pins it in the task definition.
3. Riff-Raff's normal `cloud-formation` deployment updates the task definition. There's no separate artifact
   upload step.

To run a backfill, start an execution of the `trove-backfill-<STAGE>` Step Function (created by `GuEcsTask`). The
input is ignored.

### Prerequisites before this can deploy

- The ECR repository `guardian/trove/trove-backfill` must exist, and the repo needs a `GU_ARTIFACTS_ROLE_ARN`
  secret with push access. Both are set up in [guardian/riffraff-platform](https://github.com/guardian/riffraff-platform).
- The SSM SecureString `/<STAGE>/content-api/trove-backfill/capi-api-key` must exist.
