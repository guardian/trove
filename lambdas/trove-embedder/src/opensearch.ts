import { errors } from '@opensearch-project/opensearch';
import type { ArticleV1 } from 'datastore/article';
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
	document: ArticleV1,
	internalRevision: number,
): Promise<void> {
	await Promise.all(
		Object.values(articleIndices).map(async ({ name }) => {
			try {
				await client.index({
					index: name,
					id: articleId,
					version: internalRevision,
					version_type: 'external',
					body: document,
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
				if (error instanceof errors.ResponseError) {
					throw describeResponseError('write', error, name, articleId);
				}
				throw error;
			}
		}),
	);
}

/**
 * Deletes the document from every declared index version.
 * Delete events carry no internalRevision, so this is an unversioned delete: if an older update
 * is processed afterwards (e.g. a retry, DLQ redrive or backfill), it will re-add the article.
 */
export async function deleteArticle(articleId: string): Promise<void> {
	await Promise.all(
		Object.values(articleIndices).map(async ({ name }) => {
			try {
				await client.delete({ index: name, id: articleId });
			} catch (error) {
				if (isNotFound(error)) {
					console.log('Skipping delete, article not stored', {
						index: name,
						articleId,
					});
					return;
				}
				if (error instanceof errors.ResponseError) {
					throw describeResponseError('delete', error, name, articleId);
				}
				throw error;
			}
		}),
	);
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
