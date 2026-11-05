#!/usr/bin/env bash
# Starts the local OpenSearch and seeds it with sample articles
set -euo pipefail
cd "$(dirname "$0")/.."

docker compose up -d

echo "Waiting for OpenSearch..."
until curl -sf 'http://localhost:9200/_cluster/health?wait_for_status=yellow' >/dev/null; do
	sleep 2
done

npm run seed -w datastore
