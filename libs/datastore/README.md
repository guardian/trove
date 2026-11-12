# datastore

The article schema, its OpenSearch mapping, and the scripts that set up the indices.

- `src/article.ts`: the article schema in zod. The OpenSearch mapping is derived from it (`src/mapping.ts`).
- `src/open-search-embeddings.ts`: the embedding models and their `knn_vector` settings.
- `src/indices.ts`: the versioned indices.

## Versions

Each schema version has its own index (`articles-v1`, ...) declared in `src/indices.ts`.

To create a new version:

1. Add `ArticleV2` and register `v2` in `articleIndices` of `src/indices.ts`. Update the embedder lambda to write to both versions.
2. PR, run `npm run apply-schema` on CODE and PROD before merging and deploy.
3. Trigger the backfilling job.
4. When the backfill is complete, remove `v1` from `articleIndices`, update the API to read from `v2`. PR merge and deploy.
5. Delete the old index with `npm run delete-index -w datastore -- articles-v1`.

When iterating locally, run `npm run delete-index -w datastore -- articles-v1` then `./scripts/setup.sh` to recreate the index.

## Scripts

By default, scripts target local docker-compose OpenSearch. To target OpenSearch Serverless, set `OPENSEARCH_ENDPOINT` to the collection endpoint and get Janus credentials for the `capi` profile.

### apply-schema

Creates the article indices if missing. Safe to re-run.

```sh
npm run apply-schema -w datastore                                  # local docker-compose
OPENSEARCH_ENDPOINT=https://... npm run apply-schema -w datastore  # Serverless
```

### delete-index

Deletes an index after asking for confirmation.
On AWS, only indices no longer declared in `articleIndices` can be deleted, e.g. the old version after a migration.
Locally, declared indices can be deleted too, e.g. to recreate one after changing its mapping.

```sh
npm run delete-index -w datastore -- articles-v1                                  # local docker-compose
OPENSEARCH_ENDPOINT=https://... npm run delete-index -w datastore -- articles-v1  # Serverless
```

### seed-local

Local only: seeds docker-compose OpenSearch with a few documents with random embeddings. Fixed ids make it safe to re-run.

```sh
npm run seed-local -w datastore   # or ./scripts/setup.sh from the repo root
```
