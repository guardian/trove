/**
 * Local only: deletes the article indices on docker-compose OpenSearch, e.g. after changing a mapping.
 *
 *   npm run drop-local-indices -w datastore
 */
import { createClient } from '../src/client.ts';
import { articleIndices } from '../src/indices.ts';

if (process.env.OPENSEARCH_ENDPOINT) {
	throw new Error('drop-local-indices refuses to run against AWS');
}

const index = Object.values(articleIndices).map(({ name }) => name);
await createClient().indices.delete({ index, ignore_unavailable: true });
console.log(`Dropped ${index.join(', ')}`);
