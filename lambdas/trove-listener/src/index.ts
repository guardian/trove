import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { KinesisStreamEvent } from 'aws-lambda';
import { fetchContent } from 'shared/capi';
import { processBatch } from './processBatch.ts';

const capiKeyParameter = process.env.CAPI_KEY_PARAMETER;
if (!capiKeyParameter) {
	throw new Error('CAPI_KEY_PARAMETER is not set');
}
// Resolved once per cold start rather than on every invocation
let capiKey: Promise<string> | undefined;

async function resolveCapiKey(): Promise<string> {
	capiKey ??= new SSMClient({})
		.send(
			new GetParameterCommand({
				Name: capiKeyParameter,
				WithDecryption: true,
			}),
		)
		.then(({ Parameter }) => {
			if (!Parameter?.Value) {
				throw new Error(`SSM parameter ${capiKeyParameter} has no value`);
			}
			return Parameter.Value;
		})
		.catch((error: unknown) => {
			capiKey = undefined;
			throw error;
		});
	return capiKey;
}

export const handler = async (event: KinesisStreamEvent): Promise<void> => {
	const key = await resolveCapiKey();
	return processBatch(
		event,
		(capiUrl) => fetchContent(capiUrl, key),
		process.env.LIVE_EMBEDDER_QUEUE_URL,
	);
};
