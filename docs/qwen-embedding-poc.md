# Qwen3-VL-Embedding-8B PoC

A proof of concept that self-hosts [Qwen3-VL-Embedding-8B](https://huggingface.co/Qwen/Qwen3-VL-Embedding-8B) on ECS,
as a possible replacement for Marengo. Nothing calls it yet.

Defined in [`cdk/lib/trove-qwen-embedding.ts`](../cdk/lib/trove-qwen-embedding.ts) as its own stack,
`TroveQwenEmbedding-<STAGE>`. It is in `riff-raff.yaml` for CODE and PROD, but for now we only deploy it to CODE.

## How it works

- One `g6.xlarge` (1x NVIDIA L4, 24 GB) in an ASG on the
  [ECS GPU-optimised AMI](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-gpu.html), attached to an ECS
  cluster as a capacity provider. Fargate has no GPUs.
- The task runs our [`trove-qwen-embedding` image](../services/trove-qwen-embedding/Dockerfile). It is the upstream
  [`vllm/vllm-openai`](https://hub.docker.com/r/vllm/vllm-openai) image, pinned by digest, with the args to serve the
  model in pooling mode. It downloads the weights from Hugging Face on first start and caches them on the instance.
- It serves vLLM's OpenAI-compatible API on port 8000 of the instance. There's no load balancer and no ingress, so use
  SSM port forwarding.
- Embeddings are the full 4096 dimensions.

The first start is slow (about 10 minutes or more) because of the image pull (about 10 GB) and the weight download
(about 16 GB). Watch the CloudWatch logs for the task.

## How does CI/CD work?

The same as [trove-backfill](../tasks/trove-backfill/README.md#how-does-cicd-work):

1. CI (`qwen-embedding-image` job) builds the x86 image and pushes it to the central ECR repository
   `guardian/trove/trove-qwen-embedding` with [`guardian/actions-ecr`](https://github.com/guardian/actions-ecr).
2. The image digest is passed to `cdk synth` as `QWEN_EMBEDDING_IMAGE_DIGEST`, which pins it in the task definition.
3. Riff-Raff's normal `cloud-formation` deployment updates the task definition.

## Running locally

You need an NVIDIA GPU with at least 24 GB of memory and the
[NVIDIA Container Toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html),
so this won't work on a Mac. From the repo root:

```sh
docker build --platform linux/amd64 -t trove-qwen-embedding services/trove-qwen-embedding
docker run --rm --gpus all --ipc=host -p 8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface trove-qwen-embedding
```

## Trying it out in AWS

With Janus credentials for the account:

```sh
# Find the GPU instance
INSTANCE_ID=$(aws ec2 describe-instances --profile capi --region eu-west-1 \
  --filters "Name=tag:App,Values=trove-qwen-embedding" "Name=tag:Stage,Values=CODE" "Name=instance-state-name,Values=running" \
  --query 'Reservations[0].Instances[0].InstanceId' --output text)

# Forward localhost:8000 to the vLLM server (leave this running)
aws ssm start-session --profile capi --region eu-west-1 --target "$INSTANCE_ID" \
  --document-name AWS-StartPortForwardingSession --parameters portNumber=8000,localPortNumber=8000

# In another terminal
curl -s localhost:8000/v1/embeddings -H 'Content-Type: application/json' \
  -d '{"model": "Qwen/Qwen3-VL-Embedding-8B", "input": "Storm Benedict brings flooding to the north of England"}' \
  | jq '.data[0].embedding | length'
```

## Turning it off

The GPU instance is expensive to leave running. Set the ECS service's desired count to 0 (in the console, or with
`aws ecs update-service --desired-count 0`). Capacity provider managed scaling then terminates the instance. Set it
back to 1 to bring it up again. A redeploy also resets it to 1.

## Known limitations

- Every CI run pulls the vLLM base image (about 10 GB) from Docker Hub. ECR already has the layers after the first push,
  so later pushes are quick.
- We use a plain ASG rather than `GuAutoScalingGroup`, because the latter requires an AMIgo image.
- The account may need a G-instance vCPU quota increase in eu-west-1.
