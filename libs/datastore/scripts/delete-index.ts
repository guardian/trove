/**
 * Deletes an index that's no longer declared in `articleIndices`, e.g. the old version after a migration.
 * Asks for confirmation first.
 *
 *   OPENSEARCH_ENDPOINT=https://... npm run delete-index -w datastore -- articles-v1
 */
import { createInterface } from 'node:readline/promises';
import { createClient } from '../src/client.ts';
import { articleIndices } from '../src/indices.ts';

const index = process.argv[2];
if (!index) {
	throw new Error('Usage: npm run delete-index -w datastore -- <index>');
}
// Code may still read or write a declared index, and apply-schema would re-create it anyway
if (Object.values(articleIndices).some(({ name }) => name === index)) {
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
