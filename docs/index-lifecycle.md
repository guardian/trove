# Index lifecycle ADR

This document describes how the OpenSearch schema evolves over time, from creating an index to deleting it.

# Context

Embeddings and article fields will change over time: new embedding models, new fields, different vector settings. The schema is defined in code, and the OpenSearch mapping is derived from it. The documents live in OpenSearch Serverless, which is written to by the embedder and read by the API.

# Decisions

## Decision: Version the OpenSearch schema, with one index per version

Each schema version has its own index, declared in code. Changes that OpenSearch can't apply to an existing index (a field type, an embedding's dimension or vector settings) mean creating a new version.

A new version goes through this lifecycle:

1. Declare the new version, and make the embedder write to both the old and the new version. Create the new index in each environment, then deploy.
2. Backfill the new version.
3. Switch the API to read from the new version, and stop writing to the old one. Deploy.
4. Delete the old index.

**Reasoning**:

- OpenSearch can't change the type or vector settings of an existing field. Any significant change needs a new index filled by our own pipeline.
- The document shape lives in code and changes on deploy. Having the index referenced in code provides a strong document shape guarantee.
- Creating an index ahead of a deploy is harmless, as nothing uses it until the deploy.

**Alternative**: Update the mapping of the existing index in place.

BUT - OpenSearch only allows adding new fields. Changing a field type, or an embedding's dimension, is impossible, so we need versions anyway. Adding an optional field to an existing index remains possible, but isn't supported by our tooling yet, and existing documents wouldn't have the field until they're re-written.

**Alternative**: Create a new index and copy the documents across with OpenSearch's reindex operation.

BUT - reindex isn't available on OpenSearch Serverless. We need to re-embed through our backfill pipeline anyway.

**Alternative**: Two aliases `live` and `next`: one that readers query, and one for the version being built. Writers write to both.

BUT - aliases change when someone moves them, while the document shape changes on deploy. However, in order to switch to a new version, we need to deploy and move the aliases at the same time, which is impractical.

**Consequences**:

- Switching reads, and rolling back, requires a deploy.
- If a service outside this repo ever queries the index, it will need a stable name, for example an alias it owns.
- Creating and deleting indices is a manual step, run by an engineer.
