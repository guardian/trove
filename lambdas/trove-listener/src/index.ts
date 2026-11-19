import type { KinesisStreamEvent } from 'aws-lambda';
import { getParameter } from 'shared/ssm';
import { processBatch } from './processBatch.ts';
import { capiFetcher } from './toEmbeddingEvent.ts';

const capiKeyParameter = process.env.CAPI_KEY_PARAMETER;
if (!capiKeyParameter) {
	throw new Error('CAPI_KEY_PARAMETER is not set');
}
// Resolved once per cold start rather than on every invocation
const capiKey = getParameter(capiKeyParameter);

export const handler = async (event: KinesisStreamEvent): Promise<void> =>
	processBatch(
		event,
		capiFetcher(await capiKey),
		process.env.LIVE_EMBEDDER_QUEUE_URL,
	);
