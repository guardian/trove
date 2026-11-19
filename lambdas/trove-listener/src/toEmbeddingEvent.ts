import { randomUUID } from 'node:crypto';
import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import type { Content } from '@guardian/content-api-models/v1/content.js';
import { fetchContent as defaultFetchContent } from 'shared/capi';
import { contentToPayload } from 'shared/contentToPayload';
import type { EmbeddingEvent } from 'shared/embeddingEvent';

export type FetchContent = (capiUrl: string) => Promise<Content | undefined>;

/** Returns undefined for any Crier event that doesn't result in an embedding change. */
export async function toEmbeddingEvent(
	event: Event,
	fetchContent: FetchContent,
): Promise<EmbeddingEvent | undefined> {
	if (event.itemType !== ItemType.CONTENT) {
		return undefined;
	}

	if (event.eventType === EventType.DELETE) {
		return {
			embeddingEventId: randomUUID(),
			source: 'listener',
			eventType: 'delete',
			payload: { articleId: event.payloadId },
		};
	}

	const content = await resolveContent(event, fetchContent);
	const payload = content && contentToPayload(content);
	return (
		payload && {
			embeddingEventId: randomUUID(),
			source: 'listener',
			eventType: 'update',
			payload,
		}
	);
}

async function resolveContent(
	event: Event,
	fetchContent: FetchContent,
): Promise<Content | undefined> {
	switch (event.payload?.kind) {
		case 'content':
			return event.payload.content;
		case 'retrievableContent':
			return fetchContent(event.payload.retrievableContent.capiUrl);
		default:
			return undefined;
	}
}

export const capiFetcher =
	(apiKey: string): FetchContent =>
	(capiUrl) =>
		defaultFetchContent(capiUrl, apiKey);
