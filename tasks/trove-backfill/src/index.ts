import { searchBackfillContent } from 'shared/capi';
import { sendEmbeddingEvents } from 'shared/sqs';
import { getSsmParameter } from 'shared/ssm';
import { backfillFirstPage } from './backfill.ts';

const capiKeyParameter = process.env.CAPI_KEY_PARAMETER;
if (!capiKeyParameter) {
	throw new Error('CAPI_KEY_PARAMETER is not set');
}
const queueUrl = process.env.BACKFILL_EMBEDDER_QUEUE_URL;
if (!queueUrl) {
	throw new Error('BACKFILL_EMBEDDER_QUEUE_URL is not set');
}

const main = async () => {
	const key = await getSsmParameter(capiKeyParameter);
	await backfillFirstPage(
		() => searchBackfillContent(key),
		(events) => sendEmbeddingEvents(queueUrl, events),
	);
};

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
