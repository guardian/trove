import { errors } from '@opensearch-project/opensearch';
import { createClient } from 'datastore/client';
import { articleIndices } from 'datastore/indices';

// Created once so connections are reused across invocations
const client = createClient();

/**
 * Writes the document to every declared index version, keyed by the article id.
 * The internalRevision is used as an external version, so an older revision never overwrites a newer one.
 */
export async function writeArticle(
	articleId: string,
	document: unknown,
	internalRevision: number,
): Promise<void> {
	await Promise.all(
		Object.values(articleIndices).map(async ({ name, schema }) => {
			try {
				await client.index({
					index: name,
					id: articleId,
					version: internalRevision,
					version_type: 'external',
					body: schema.parse(document),
				});
			} catch (error) {
				if (isVersionConflict(error)) {
					console.log('Skipping stale write, a newer revision is stored', {
						index: name,
						articleId,
						internalRevision,
					});
					return;
				}
				throw error;
			}
		}),
	);
}

const isVersionConflict = (error: unknown): boolean =>
	error instanceof errors.ResponseError && error.statusCode === 409;
