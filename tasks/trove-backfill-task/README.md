# trove-backfill-task

**Proof of concept** of running the CAPI backfill as an ECS Fargate task (via GuCDK's `GuEcsTask`), as an alternative to a Step Function repeatedly invoking the `trove-backfill` Lambda.

It pages through CAPI oldest-first using the `/next` endpoint ([example](https://github.com/guardian/content-api/pull/2812)). For now, it writes each item to stdout (CloudWatch Logs) rather than the backfill queue.

## How it's deployed

This follows the pattern used by [Lurch's tasks](https://github.com/guardian/lurch/blob/main/packages/infra/LurchTasksCDK.ts):

1. CI bundles `src/main.ts` into `dist/trove-backfill-task.zip`.
2. Riff-Raff uploads the ZIP to the dist bucket at `content-api/<STAGE>/trove-backfill-task/`. This uses an `aws-s3` deployment that `cdk/lib/trove-root.ts` adds to the GuCDK-generated `riff-raff.yaml`.
3. When the task starts, its command downloads and unzips the ZIP into a writable volume, reads the CAPI key from SSM and runs `node index.js`.

The container image is the public `public.ecr.aws/sam/build-nodejs24.x` image. It has Node, the AWS CLI and unzip, so this PoC doesn't need its own ECR repository or image build.

## Setup

Create the CAPI key as a `SecureString` in Parameter Store at `/<STAGE>/content-api/trove-backfill-task/capiApiKey`.

## Running

Start an execution of the `trove-backfill-task-<STAGE>` Step Function. All input fields are optional:

```sh
aws stepfunctions start-execution \
  --state-machine-arn <arn from the stack outputs> \
  --input '{"capiParams": {"from-date": "2020-01-01", "to-date": "2020-01-31"}, "pageSize": 200}'
```

- `capiParams` are merged over the defaults in `src/main.ts` (`type=article`, plus the fields and tags we embed).
- `startAfterId` resumes a failed run from the `lastSeenId` in its last `Progress:` log line.

Locally:

```sh
CAPI_API_KEY=<key> BACKFILL_INPUT='{"capiParams": {"from-date": "2020-01-01", "to-date": "2020-01-01"}}' npm start -w trove-backfill-task
```
