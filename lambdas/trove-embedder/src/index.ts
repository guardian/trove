import type { SQSHandler } from 'aws-lambda';

export const handler: SQSHandler = async (event) => {
	console.log(`Received ${event.Records.length} messages`);
	for (const record of event.Records) {
		console.log(
			`Message ${record.messageId} from ${record.eventSourceARN}: ${record.body}`,
		);
	}
	await Promise.resolve();
};
