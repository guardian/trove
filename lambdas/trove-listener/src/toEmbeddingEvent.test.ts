import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Event } from '@guardian/content-api-models/crier/event/v1/event.js';
import { EventType } from '@guardian/content-api-models/crier/event/v1/eventType.js';
import { ItemType } from '@guardian/content-api-models/crier/event/v1/itemType.js';
import { sampleContent } from 'shared/testing/fixtures';
import { Int64 } from 'thrift';
import { toEmbeddingEvent } from './toEmbeddingEvent.ts';

const crierEvent = (overrides: Partial<Event>): Event => ({
	payloadId: sampleContent.id,
	eventType: EventType.UPDATE,
	itemType: ItemType.CONTENT,
	dateTime: new Int64(1_700_000_000_000),
	...overrides,
});

const noFetch = () => Promise.reject(new Error('Unexpected CAPI fetch'));

void describe('toEmbeddingEvent', () => {
	void it('maps an update carrying content', async () => {
		const result = await toEmbeddingEvent(
			crierEvent({ payload: { kind: 'content', content: sampleContent } }),
			noFetch,
		);
		assert.equal(result?.eventType, 'update');
		assert.equal(result.source, 'listener');
		assert.equal(result.payload.articleId, sampleContent.id);
	});

	void it('fetches content for a retrievable update', async () => {
		const fetched: string[] = [];
		const result = await toEmbeddingEvent(
			crierEvent({
				eventType: EventType.RETRIEVABLEUPDATE,
				payload: {
					kind: 'retrievableContent',
					retrievableContent: {
						id: sampleContent.id,
						capiUrl: sampleContent.apiUrl,
					},
				},
			}),
			(capiUrl) => {
				fetched.push(capiUrl);
				return Promise.resolve(sampleContent);
			},
		);
		assert.deepStrictEqual(fetched, [sampleContent.apiUrl]);
		assert.equal(result?.eventType, 'update');
	});

	void it('maps a delete', async () => {
		const result = await toEmbeddingEvent(
			crierEvent({ eventType: EventType.DELETE }),
			noFetch,
		);
		assert.equal(result?.eventType, 'delete');
		assert.deepStrictEqual(result.payload, { articleId: sampleContent.id });
	});

	void it('ignores non-content items', async () => {
		const result = await toEmbeddingEvent(
			crierEvent({ itemType: ItemType.TAG, eventType: EventType.DELETE }),
			noFetch,
		);
		assert.equal(result, undefined);
	});
});
