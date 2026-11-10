/**
 * Creates the article indices and aliases if missing. Safe to re-run.
 *
 *   npm run apply-schema -w datastore                                  # local docker-compose
 *   OPENSEARCH_ENDPOINT=https://... npm run apply-schema -w datastore  # Serverless, with capi Janus credentials
 */
import { applySchema } from '../src/apply-schema.ts';
import { createClient } from '../src/client.ts';

await applySchema(createClient());
