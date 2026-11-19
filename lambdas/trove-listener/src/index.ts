import type { KinesisStreamEvent } from 'aws-lambda';
import { getParameter } from 'shared/ssm';
import { processBatch } from './processBatch.ts';
import { capiFetcher } from './toEmbeddingEvent.ts';

const capiApiKeyParameter = process.env.CAPI_API_KEY_PARAMETER;
if (!capiApiKeyParameter) {
	throw new Error('CAPI_API_KEY_PARAMETER is not set');
}
// Resolved once per cold start rather than on every invocation
const capiApiKey = getParameter(capiApiKeyParameter);

export const handler = async (event: KinesisStreamEvent): Promise<void> =>
	processBatch(
		event,
		capiFetcher(await capiApiKey),
		process.env.LIVE_EMBEDDER_QUEUE_URL,
	);
