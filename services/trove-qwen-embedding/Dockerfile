# Serves Qwen3-VL-Embedding-8B with vLLM's OpenAI-compatible API on port 8000.
#   docker build --platform linux/amd64 -t trove-qwen-embedding services/trove-qwen-embedding
# Needs an NVIDIA GPU to run. See docs/qwen-embedding-poc.md.

# Qwen3-VL-Embedding needs vLLM >= 0.14. Pinned by digest so builds are reproducible.
FROM vllm/vllm-openai:v0.34.0@sha256:20fdb089454afbb324efa4110a2c025ff7b27cc1a086e07aa580b18df8ad1ce1

# Weights are downloaded here from Hugging Face on first start. Mount a volume to keep them between runs.
ENV HF_HOME=/root/.cache/huggingface

EXPOSE 8000

# The base image's entrypoint is `vllm serve`.
# Our inputs are headlines and standfirsts, so a short context leaves more GPU memory for batching.
CMD ["Qwen/Qwen3-VL-Embedding-8B", \
	"--runner", "pooling", \
	"--dtype", "bfloat16", \
	"--max-model-len", "8192", \
	"--port", "8000"]
