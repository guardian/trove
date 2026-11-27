# trove-backfill

Runs the historical backfill as a long-running ECS Fargate task.

For now it makes a single CAPI `/search` request (newest first, articles and liveblogs, 200 per page, in thrift) and
sends the content we embed to the backfill queue as `UpdateEmbeddingEvent`s. Paging through the rest of CAPI (using
`/content/{lastSeenId}/next` with the same query, see [docs/backfill.md](../../docs/backfill.md) and
[content-api#2812](https://github.com/guardian/content-api/pull/2812)) comes next. It logs the last seen ID, which will
become the cursor.

It needs two environment variables, both set in CDK:

- `CAPI_KEY_PARAMETER`: the name of the SSM parameter holding the CAPI key
- `BACKFILL_EMBEDDER_QUEUE_URL`: the queue to send embedding events to

## Running locally

### Running directly

Since the container just runs the TypeScript code with node, you can run it directly on your host machine and it should behave pretty much the same as it would in the container.

Provide both environment variables, plus AWS credentials that can read the SSM parameter and send to the queue:

```sh
CAPI_KEY_PARAMETER=<ssm-parameter-name> \
BACKFILL_EMBEDDER_QUEUE_URL=<url> \
AWS_REGION=eu-west-1 \
AWS_PROFILE=capi \
npm start -w trove-backfill
```

### Running in Docker

This builds and runs the same image that runs in Fargate. Run these from the **repo root**, because the build needs
the npm workspaces (e.g. `libs/shared`).

The image is built on [Docker Hardened Images](https://docs.docker.com/dhi/), so you need to sign in to their registry
once with a (free) Docker account.

```sh
# Sign in to the Docker Hardened Images registry (only needed once)
docker login dhi.io

# Build the image and tag (name) it trove-backfill. Re-run this after changing the code.
docker build -f tasks/trove-backfill/Dockerfile -t trove-backfill .

# Run it, using AWS credentials from ~/.aws (e.g. from Janus). --rm deletes the container when it exits, and
# --read-only matches the read-only filesystem in Fargate. Output goes straight to your terminal.
docker run --rm --read-only \
  -v ~/.aws:/home/node/.aws:ro \
  -e AWS_PROFILE=capi \
  -e AWS_REGION=eu-west-1 \
  -e CAPI_KEY_PARAMETER=<ssm-parameter-name> \
  -e BACKFILL_EMBEDDER_QUEUE_URL=<url> \
  trove-backfill
```

## Running in AWS

In the AWS console: Step Functions → `trove-backfill-<STAGE>`, then click into an execution.

## How does CI/CD work?

1. CI (`backfill-image` job) builds the ARM64 image and pushes it to the central ECR repository
   `guardian/trove/trove-backfill` with [`guardian/actions-ecr`](https://github.com/guardian/actions-ecr).
2. The image digest is passed to `cdk synth` as `IMAGE_DIGEST`, which pins it in the task definition.
3. Riff-Raff's normal `cloud-formation` deployment updates the task definition. There's no separate artifact
   upload step.

To run a backfill, start an execution of the `trove-backfill-<STAGE>` Step Function (created by `GuEcsTask`). The
input is ignored.

## Appendix: useful Docker commands

```sh
# Run it in the background (-d) with a name, then follow its logs (Ctrl+C stops following, not the container)
docker run -d --name backfill trove-backfill
docker logs -f backfill

# List running containers (add -a to include stopped ones), then stop and remove one
docker ps -a
docker stop backfill
docker rm backfill

# List images, and remove this one
docker image ls
docker image rm trove-backfill
```

The runtime image has no shell, so `docker run ... sh` and `docker exec ... sh` won't work. To look around, get a shell
in the build stage instead (type `exit` to leave):

```sh
docker build -f tasks/trove-backfill/Dockerfile --target builder -t trove-backfill-builder .
docker run --rm -it trove-backfill-builder sh
```
