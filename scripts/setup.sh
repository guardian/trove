#!/usr/bin/env bash

set -euo pipefail
cd "$(dirname "$0")/.."

mise install
npm install

docker compose up -d

echo "Waiting for OpenSearch..."
until curl -sf 'http://localhost:9200/_cluster/health?wait_for_status=yellow' >/dev/null; do
	sleep 2
done

npm run seed-local -w datastore
