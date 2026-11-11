#!/usr/bin/env bash
# Checks the "Run Trove locally" developer policy by embedding "hello world" with Marengo via Bedrock.
# Usage: AWS_PROFILE=<janus-profile> ./scripts/test-dev-policy.sh
set -euo pipefail

MODEL_ID="eu.twelvelabs.marengo-embed-3-0-v1:0"
OUT_FILE="$(mktemp)"
trap 'rm -f "$OUT_FILE"' EXIT

aws bedrock-runtime invoke-model \
	--region eu-west-1 \
	--model-id "$MODEL_ID" \
	--content-type application/json \
	--accept application/json \
	--cli-binary-format raw-in-base64-out \
	--body '{"inputType":"text","text":{"inputText":"hello world"}}' \
	"$OUT_FILE" >/dev/null

echo "Success! Response (truncated):"
head -c 300 "$OUT_FILE"
echo
