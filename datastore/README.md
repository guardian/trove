# datastore

The article schema, its OpenSearch mapping, and the scripts that set up the indices.

- `src/article.ts`: the article schema in zod. The OpenSearch mapping is derived from it (`src/mapping.ts`).
- `src/os-embeddings.ts`: the embedding models and their `knn_vector` settings.
- `src/indices.ts`: the versioned indices, the aliases, and which version each alias points to.

## Versions and aliases

Each schema version has its own index (`articles-v1`, ...). Two aliases sit on top:

- `articles-current`: what readers query.
- `articles-next`: the index being built. Writers write to both aliases (once when they point to the same index).

OpenSearch Serverless has no `_reindex`, so moving to a new version goes like this:

1. Add `ArticleV2` and register `v2` in `articleIndices`.
2. Point `next` at `v2` in `aliasTargets` and run `init-schema`. From then on, new writes go to both indices.
3. Backfill `v2`.
4. Point `current` at `v2` and run `init-schema`.
5. Remove `v1` and delete its index.

## Commands

```sh
./scripts/setup.sh                    # from the repo root: start docker-compose OpenSearch, reset and seed it
npm run init-schema -w datastore      # create missing indices and move aliases; safe to re-run
npm run seed -w datastore             # local only: reset the indices and seed sample articles
```

`init-schema` targets local docker-compose by default. To target OpenSearch Serverless, set `OPENSEARCH_ENDPOINT` to the collection endpoint and get Janus credentials for the `capi` profile using the `trove-opensearch-admin` developer policy.
