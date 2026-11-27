import { EventSerde } from '@guardian/content-api-models/crier/event/v1/event.js';
import type { KinesisStreamEvent } from 'aws-lambda';
import { sendEmbeddingEvents } from 'shared/sqs';
import { decodeThrift } from 'shared/thrift';
import type { FetchContent } from './toEmbeddingEvent.ts';
import { toEmbeddingEvent } from './toEmbeddingEvent.ts';

/**
 * The Kinesis batch size matches the SQS batch limit (10), so a batch is sent in a single request.
 * Any failure fails the whole batch, which Kinesis then retries.
 */
export async function processBatch(
	event: KinesisStreamEvent,
	fetchContent: FetchContent,
	queueUrl: string,
): Promise<void> {
	const results = await Promise.allSettled(
		event.Records.map(async (record) =>
			toEmbeddingEvent(
				decodeThrift(Buffer.from(record.kinesis.data, 'base64'), EventSerde),
				fetchContent,
			),
		),
	);
	const failure = results.find((result) => result.status === 'rejected');
	if (failure) {
		throw failure.reason;
	}
	const successfulResults = results as Array<
		PromiseFulfilledResult<Awaited<ReturnType<typeof toEmbeddingEvent>>>
	>;
	const embeddingEvents = successfulResults.flatMap((result) => {
		if (result.value === undefined) {
			return [];
		}
		return [result.value];
	});

	if (embeddingEvents.length === 0) {
		return;
	}

	await sendEmbeddingEvents(queueUrl, embeddingEvents);
}
