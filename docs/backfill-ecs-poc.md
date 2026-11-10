# Backfill: ECS Fargate proof of concept

We're deciding how to run the backfill, which pages through historical CAPI content and queues it for the embedder. The options are:

- **ECS Fargate task:** the backfill is basically a long-running pagination loop.
- **Step Function:** it repeatedly invokes the `trove-backfill` Lambda.

This PoC implements the ECS option so that we can see how much we like it. It writes to stdout rather than the backfill queue for now. For usage, see [`tasks/trove-backfill-task/README.md`](../tasks/trove-backfill-task/README.md).

## What's there

- **`tasks/trove-backfill-task`:**
  - Pages through CAPI oldest-first. It starts with `/search`, then follows `/content/{id}/next` (see [the example in guardian/content-api#2812](https://github.com/guardian/content-api/pull/2812)).
  - Prints one JSON line per item.
  - Retries 429s, 5xxs and network errors.
  - Can resume a failed run from the last ID it logged.
- **`cdk/lib/backfill-task.ts`:**
  - A `GuEcsTask` (0.25 vCPU, 24h timeout, with failure and timeout alarms).
  - Like Lurch, the task downloads its ZIP from the dist bucket into a writable volume and runs `node index.js`. The container's root filesystem is read-only.
- **`cdk/lib/trove-root.ts`:** replaces `GuRoot` in order to add an `aws-s3` Riff-Raff deployment for the task's ZIP. GuCDK only generates deployments for Lambdas, EC2 apps and CloudFormation.
- **CI:** packages the task and uploads it to Riff-Raff.

## Where this differs from Lurch

The PoC follows [Lurch's tasks](https://github.com/guardian/lurch/blob/main/packages/infra/LurchTasksCDK.ts) where it makes sense. These are the differences:

- **Container image:**
  - Lurch builds its own base image (Ubuntu, Node, AWS CLI) and pushes it to ECR [from CI](https://github.com/guardian/lurch/tree/main/packages/infra/tasks-container).
  - This PoC uses the public `public.ecr.aws/sam/build-nodejs24.x` image, which already has Node, the AWS CLI and unzip.
  - That avoids an ECR repository, an image-build workflow and a GitHub Actions push role.
  - The image is about 3 GB, but pull time doesn't matter for a long-running job.
  - If we go with ECS, we may want our own slimmer image.
- **Security group:**
  - We add a `GuHttpsEgressSecurityGroup`.
  - Without one, `GuEcsTask` uses the VPC's default security group. In Guardian accounts that usually allows no outbound traffic, so the task couldn't reach S3, SSM or CAPI.
  - Lurch also passes its own security group.
- **Task input:**
  - The whole Step Function execution input is passed to the task as JSON in `BACKFILL_INPUT`, so every field is optional.
  - Lurch's `migrate-db` maps a single required field (`$.version`) to an environment variable. That approach fails the execution if the field is missing.
- **CAPI key:** the task's start-up command reads the key from SSM with the AWS CLI, so the bundle doesn't depend on the AWS SDK. Lurch reads its secrets from Node code.

## Before it can run

Create the CAPI key as a `SecureString` in Parameter Store at `/<STAGE>/content-api/trove-backfill-task/capiApiKey`.

## Testing so far

- Unit tests cover pagination, resuming and retries.
- The packaged ZIP ran inside the real container image, with a read-only root filesystem and the same writable volume setup, against a mock CAPI.
- It hasn't run against real CAPI yet, because the public `test` key was rejected.
- It hasn't been deployed yet.

## Things to weigh up

**In favour of ECS:**

- The backfill is plain code: a single loop, with no state passed between invocations.
- `GuEcsTask` provides the Step Function wrapper, so runs can be started with input and are alarmed on failure or timeout.
- There's no 15-minute limit.

**Against ECS:**

- It needs a custom Riff-Raff deployment, because GuCDK doesn't generate one for ECS tasks.
- A container image needs choosing and maintaining.
- The task takes about a minute to start, while the image is pulled.
- There's no automatic checkpointing. After a failure, we resume manually from the last ID logged.
