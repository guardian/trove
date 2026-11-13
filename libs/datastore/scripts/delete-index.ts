/**
 * Deletes an index after asking for confirmation.
 * On AWS, only indices no longer declared in `articleIndices` can be deleted, e.g. the old version after a migration.
 * Locally, declared indices can be deleted too, e.g. to recreate one after changing its mapping.
 *
 *   npm run delete-index -w datastore -- articles-v1                                  # local docker-compose
 *   OPENSEARCH_ENDPOINT=https://... npm run delete-index -w datastore -- articles-v1  # Serverless
 */
import { createInterface } from 'node:readline/promises';
import { createClient } from '../src/client.ts';
import { articleIndices } from '../src/indices.ts';

const index = process.argv[2];
if (!index) {
	throw new Error('Usage: npm run delete-index -w datastore -- <index>');
}
// On CODE and PROD, we don't want to delete an index that's still referenced in our logic
if (
	process.env.OPENSEARCH_ENDPOINT &&
	Object.values(articleIndices).some(({ name }) => name === index)
) {
	throw new Error(
		`"${index}" is still declared in articleIndices, remove it first`,
	);
}

const client = createClient();
const { body } = await client.count({ index });

console.log(`
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
  WARNING: this permanently deletes an index and all its documents
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

  Endpoint:  ${process.env.OPENSEARCH_ENDPOINT ?? 'http://localhost:9200'}
  Index:     ${index}
  Documents: ${body.count}
`);

const readline = createInterface({
	input: process.stdin,
	output: process.stdout,
});
const answer = await readline.question(
	`Type the index name to confirm deletion: `,
);
readline.close();

if (answer !== index) {
	console.log('Aborted, nothing was deleted');
	process.exit(1);
}

await client.indices.delete({ index });
console.log(`Deleted "${index}"`);
