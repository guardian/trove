import type { Client } from '@opensearch-project/opensearch';
import { articleIndices } from './indices.ts';

/**
 * Creates every index declared in `articleIndices`, if missing.
 * Never deletes or modifies an existing index, see datastore/README instructions for creating indices.
 */
export const applySchema = async (client: Client): Promise<void> => {
	for (const { name, mapping } of Object.values(articleIndices)) {
		if ((await client.indices.exists({ index: name })).body) {
			console.log(`Index "${name}" already exists`);
			continue;
		}
		await client.indices.create({
			index: name,
			body: { settings: { index: { knn: true } }, mappings: mapping },
		});
		console.log(`Created index "${name}"`);
	}
};
