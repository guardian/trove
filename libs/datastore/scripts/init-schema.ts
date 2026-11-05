/**
 * Creates the article indices and aliases if missing. Safe to re-run.
 *
 *   npm run init-schema -w datastore                                  # local docker-compose
 *   OPENSEARCH_ENDPOINT=https://... npm run init-schema -w datastore  # Serverless, with AWS credentials
 */
import { createClient } from '../src/client.ts';
import { initSchema } from '../src/init.ts';

await initSchema(createClient());
