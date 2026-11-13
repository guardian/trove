# trove-backfill

Runs the historical backfill as a long-running ECS Fargate task.

For now it just sends 10 dummy `UpdateEmbeddingEvent`s to the backfill queue, so we can see them come out of the
embedder logs. Paging through CAPI (using `/content/{lastSeenId}/next`, see
[content-api#2812](https://github.com/guardian/content-api/pull/2812)) comes next. The `CAPI_API_KEY` secret is
already wired up in CDK for that.

## Running locally

Without `BACKFILL_EMBEDDER_QUEUE_URL`, the messages are logged instead of sent, so no AWS credentials are needed:

```sh
npm start -w trove-backfill
```

To send to a real queue, set it and provide AWS credentials that can send to the queue:

```sh
BACKFILL_EMBEDDER_QUEUE_URL=… npm start -w trove-backfill
```

### Running in Docker

This builds and runs the same image that runs in Fargate. Run these from the **repo root**, because the build needs
the npm workspaces (e.g. `libs/shared`).

```sh
# Build the image and tag (name) it trove-backfill. Re-run this after changing the code.
docker build -f tasks/trove-backfill/Dockerfile -t trove-backfill .

# Run it. --rm deletes the container when it exits, and --read-only matches the read-only filesystem in Fargate.
# Output goes straight to your terminal. Without a queue URL, messages are logged instead of sent.
docker run --rm --read-only trove-backfill

# Send to a real queue, using AWS credentials from ~/.aws (e.g. from Janus)
docker run --rm --read-only \
  -v ~/.aws:/home/node/.aws:ro -e AWS_PROFILE=<profile> -e AWS_REGION=eu-west-1 \
  -e BACKFILL_EMBEDDER_QUEUE_URL=<url> \
  trove-backfill
```

Useful commands for poking around:

```sh
# Get a shell inside the image instead of running the backfill (type `exit` to leave)
docker run --rm -it trove-backfill sh

# Run it in the background (-d) with a name, then follow its logs (Ctrl+C stops following, not the container)
docker run -d --name backfill trove-backfill
docker logs -f backfill

# Get a shell inside a container that is still running
docker exec -it backfill sh

# List running containers (add -a to include stopped ones), then stop and remove one
docker ps -a
docker stop backfill
docker rm backfill

# List images, and remove this one
docker image ls
docker image rm trove-backfill
```

The backfill currently finishes in a second or two, so `docker exec` only works for a moment. To look around the
image, use `docker run --rm -it trove-backfill sh` instead.

## Build and deploy

1. CI (`backfill-image` job) builds the ARM64 image and pushes it to the central ECR repository
   `guardian/trove/trove-backfill` with [`guardian/actions-ecr`](https://github.com/guardian/actions-ecr).
2. The image digest is passed to `cdk synth` as `IMAGE_DIGEST`, which pins it in the task definition.
3. Riff-Raff's normal `cloud-formation` deployment updates the task definition. There's no separate artifact
   upload step.

To run a backfill, start an execution of the `trove-backfill-<STAGE>` Step Function (created by `GuEcsTask`). The
input is ignored.
