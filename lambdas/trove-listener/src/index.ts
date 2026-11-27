import type { KinesisStreamEvent } from 'aws-lambda';
import { fetchContent } from 'shared/capi';
import { getSsmParameter } from 'shared/ssm';
import { processBatch } from './processBatch.ts';

const capiKeyParameter = process.env.CAPI_KEY_PARAMETER;
if (!capiKeyParameter) {
	throw new Error('CAPI_KEY_PARAMETER is not set');
}
const queueUrl = process.env.LIVE_EMBEDDER_QUEUE_URL;
if (!queueUrl) {
	throw new Error('LIVE_EMBEDDER_QUEUE_URL is not set');
}

export const handler = async (event: KinesisStreamEvent): Promise<void> => {
	console.log('Received Kinesis batch', {
		records: event.Records.length,
		eventSourceArn: event.Records[0]?.eventSourceARN,
	});
	const key = await getSsmParameter(capiKeyParameter);
	return processBatch(event, (capiUrl) => fetchContent(capiUrl, key), queueUrl);
};
