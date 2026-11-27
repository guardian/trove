import { randomUUID } from 'node:crypto';
import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import type { Content } from '@guardian/content-api-models/v1/content.js';
import { contentToPayload } from 'shared/contentToPayload';
import type { EmbeddingEvent } from 'shared/embeddingEvent';

export type FetchContent = (capiUrl: string) => Promise<Content | undefined>;

/** Returns undefined for any Crier event that we should ignore. Anything else will be processed by the embedder. */
export async function toEmbeddingEvent(
	event: Event,
	fetchContent: FetchContent,
): Promise<EmbeddingEvent | undefined> {
	if (event.itemType !== ItemType.CONTENT) {
		return undefined;
	}

	if (event.eventType === EventType.DELETE) {
		const embeddingEvent: EmbeddingEvent = {
			embeddingEventId: randomUUID(),
			source: 'listener',
			eventType: 'delete',
			payload: { articleId: event.payloadId },
		};
		console.log('Generated embedding event', {
			embeddingEventId: embeddingEvent.embeddingEventId,
			articleId: event.payloadId,
			eventType: embeddingEvent.eventType,
		});
		return embeddingEvent;
	}

	const content = await resolveContent(event, fetchContent);
	const payload = content && contentToPayload(content);
	if (!payload) {
		return undefined;
	}
	const embeddingEvent: EmbeddingEvent = {
		embeddingEventId: randomUUID(),
		source: 'listener',
		eventType: 'update',
		payload,
	};
	console.log('Generated embedding event', {
		embeddingEventId: embeddingEvent.embeddingEventId,
		articleId: payload.articleId,
		eventType: embeddingEvent.eventType,
	});
	return embeddingEvent;
}

async function resolveContent(
	event: Event,
	fetchContent: FetchContent,
): Promise<Content | undefined> {
	switch (event.payload?.kind) {
		case 'content':
			return event.payload.content;
		case 'retrievableContent':
			try {
				const content = await fetchContent(
					event.payload.retrievableContent.capiUrl,
				);
				if (!content) {
					console.warn('Content is no longer available from CAPI', {
						articleId: event.payloadId,
						capiUrl: event.payload.retrievableContent.capiUrl,
						eventType: event.eventType,
					});
				}
				return content;
			} catch (error) {
				console.error('Failed to retrieve content from CAPI', {
					articleId: event.payloadId,
					capiUrl: event.payload.retrievableContent.capiUrl,
					eventType: event.eventType,
					error,
				});
				throw error;
			}
		default:
			console.warn('Ignoring Crier event with no embeddable payload', {
				articleId: event.payloadId,
				eventType: event.eventType,
				payloadKind: event.payload?.kind,
			});
			return undefined;
	}
}
