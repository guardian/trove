import { errors } from '@opensearch-project/opensearch';
import type { ArticleV1 } from 'datastore/article';
import { createClient } from 'datastore/client';
import { articleIndices } from 'datastore/indices';

// Created once so connections are reused across invocations
const client = createClient();

// Only v1 is written to for now; writing to several versions needs a document per schema version
const index = articleIndices.v1.name;

/**
 * Writes the document to the v1 index, keyed by the article id.
 * Its internalRevision is used as an external version, so an older revision never overwrites a newer one.
 */
export async function writeArticle(
	articleId: string,
	document: ArticleV1,
): Promise<void> {
	const { internalRevision } = document;
	try {
		await client.index({
			index,
			id: articleId,
			version: internalRevision,
			version_type: 'external',
			body: document,
		});
	} catch (error) {
		if (isVersionConflict(error)) {
			console.log('Skipping stale write, a newer revision is stored', {
				index,
				articleId,
				internalRevision,
			});
			return;
		}
		if (error instanceof errors.ResponseError) {
			throw describeResponseError('write', error, index, articleId);
		}
		throw error;
	}
}

/**
 * Deletes the document from the v1 index.
 * Delete events carry no internalRevision, so this is an unversioned delete: if an older update
 * is processed afterwards (e.g. a retry, DLQ redrive or backfill), it will re-add the article.
 */
export async function deleteArticle(articleId: string): Promise<void> {
	try {
		await client.delete({ index, id: articleId });
	} catch (error) {
		if (isNotFound(error)) {
			console.log('Skipping delete, article not stored', { index, articleId });
			return;
		}
		if (error instanceof errors.ResponseError) {
			throw describeResponseError('delete', error, index, articleId);
		}
		throw error;
	}
}

/** Puts the response body in the message, as nested objects are collapsed to [Object] in the logs. */
const describeResponseError = (
	operation: 'write' | 'delete',
	error: errors.ResponseError,
	index: string,
	articleId: string,
): Error => {
	// Not always populated, despite the types
	const meta = error.meta.meta as Partial<typeof error.meta.meta> | undefined;
	const params = meta?.request?.params;
	return new Error(
		`OpenSearch ${operation} failed: ${JSON.stringify({
			statusCode: error.statusCode,
			index,
			articleId,
			request: params && `${params.method} ${params.path}`,
			body: error.body,
		})}`,
		{ cause: error },
	);
};

const isVersionConflict = (error: unknown): boolean =>
	error instanceof errors.ResponseError && error.statusCode === 409;

const isNotFound = (error: unknown): boolean =>
	error instanceof errors.ResponseError && error.statusCode === 404;
