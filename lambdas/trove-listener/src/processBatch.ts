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
	const rejectedResults = results.flatMap((result, index) =>
		result.status === 'rejected' ? [{ result, index }] : [],
	);
	if (rejectedResults.length > 0) {
		for (const { result, index } of rejectedResults) {
			const record = event.Records[index];
			console.error('Failed to process Kinesis record', {
				eventId: record?.eventID,
				sequenceNumber: record?.kinesis.sequenceNumber,
				partitionKey: record?.kinesis.partitionKey,
				recordIndex: index,
				error: result.reason as unknown,
			});
		}
		throw rejectedResults[0]!.result.reason;
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
		console.log('Processed Kinesis batch', {
			received: event.Records.length,
			forwarded: 0,
			ignored: event.Records.length,
		});
		return;
	}

	await sendEmbeddingEvents(queueUrl, embeddingEvents);
	console.log('Processed Kinesis batch', {
		received: event.Records.length,
		forwarded: embeddingEvents.length,
		ignored: event.Records.length - embeddingEvents.length,
	});
}
