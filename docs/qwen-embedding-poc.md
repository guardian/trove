# Qwen3-VL-Embedding-8B PoC

A proof of concept that self-hosts [Qwen3-VL-Embedding-8B](https://huggingface.co/Qwen/Qwen3-VL-Embedding-8B) on ECS,
as a possible replacement for Marengo. Nothing calls it yet.

Defined in [`cdk/lib/trove-qwen-embedding.ts`](../cdk/lib/trove-qwen-embedding.ts) as its own stack,
`TroveQwenEmbedding-<STAGE>`. It is in `riff-raff.yaml` for CODE and PROD, but for now we only deploy it to CODE.

## How it works

- One `g6.xlarge` (1x NVIDIA L4, 24 GB) in an ASG on the
  [ECS GPU-optimised AMI](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs-gpu.html), attached to an ECS
  cluster as a capacity provider. Fargate has no GPUs.
- The task runs the upstream [`vllm/vllm-openai`](https://hub.docker.com/r/vllm/vllm-openai) image, pinned by digest,
  in pooling mode. It downloads the weights from Hugging Face on first start and caches them on the instance.
- It serves vLLM's OpenAI-compatible API on port 8000 of the instance. There's no load balancer and no ingress, so use
  SSM port forwarding.
- Embeddings are the full 4096 dimensions.

The first start is slow (about 10 minutes or more) because of the image pull (about 10 GB) and the weight download
(about 16 GB). Watch the CloudWatch logs for the task.

## Trying it out

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

- The image comes from Docker Hub, so it is subject to anonymous pull rate limits.
- We use a plain ASG rather than `GuAutoScalingGroup`, because the latter requires an AMIgo image.
- The account may need a G-instance vCPU quota increase in eu-west-1.
