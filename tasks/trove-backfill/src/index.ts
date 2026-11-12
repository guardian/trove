import { randomUUID } from 'node:crypto';
import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import { UpdateEmbeddingEvent } from 'shared/src/embeddingEvent.ts';

// Deliberately small, so a run demonstrates the pipeline without flooding the queue.
const PAGE_SIZE = 10;
const MAX_PAGES = 3;

type CapiContent = {
	id: string;
	type: string;
	webPublicationDate: string;
	fields?: {
		headline?: string;
		standfirst?: string;
		byline?: string;
		internalRevision?: string;
	};
	tags?: Array<{ id: string; type: string }>;
};

type CapiResponse = { response: { results: CapiContent[] } };

function requireEnv(name: string): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`Missing required environment variable ${name}`);
	}
	return value;
}

const capiUrl = process.env.CAPI_URL ?? 'https://content.guardianapis.com';
const capiApiKey = requireEnv('CAPI_API_KEY');
const fromDate = process.env.FROM_DATE;
const toDate = process.env.TO_DATE;
const dryRun = process.env.DRY_RUN === 'true';
const queueUrl = dryRun ? '' : requireEnv('BACKFILL_EMBEDDER_QUEUE_URL');
const sqs = new SQSClient({});

/**
 * The first page comes from /search. Each later page comes from
 * /content/{lastSeenId}/next, which returns the items after that one in the same order.
 *
 * @see https://github.com/guardian/content-api/pull/2812
 */
async function fetchPage(lastSeenId: string | undefined) {
	const path = lastSeenId ? `content/${lastSeenId}/next` : 'search';
	const params = new URLSearchParams({
		type: 'article,liveblog',
		'order-by': 'oldest',
		'use-date': 'published',
		'page-size': String(PAGE_SIZE),
		'show-fields': 'headline,standfirst,byline,internalRevision',
		'show-tags': 'keyword',
		'api-key': capiApiKey,
	});
	if (fromDate) {
		params.set('from-date', fromDate);
	}
	if (toDate) {
		params.set('to-date', toDate);
	}

	console.log(`Fetching /${path}`);
	const res = await fetch(`${capiUrl}/${path}?${params.toString()}`);
	if (!res.ok) {
		throw new Error(`CAPI responded ${res.status} for /${path}`);
	}
	const body = (await res.json()) as CapiResponse;
	return body.response.results;
}

function toEmbeddingEvent(content: CapiContent) {
	return UpdateEmbeddingEvent.safeParse({
		embeddingEventId: randomUUID(),
		source: 'backfiller',
		eventType: 'update',
		payload: {
			articleId: content.id,
			byline: content.fields?.byline ?? '',
			articleType: content.type,
			headline: content.fields?.headline ?? '',
			standfirst: content.fields?.standfirst ?? '',
			keywordTagIds: (content.tags ?? []).map((tag) => tag.id),
			internalRevision: Number(content.fields?.internalRevision),
			webPublicationDate: content.webPublicationDate,
		},
	});
}

async function main() {
	console.log(
		`Starting backfill from ${fromDate ?? 'the beginning'} to ${toDate ?? 'now'}, ` +
			`${MAX_PAGES} pages of ${PAGE_SIZE}${dryRun ? ' (dry run, nothing will be sent)' : ''}`,
	);

	let lastSeenId: string | undefined;
	let sent = 0;

	for (let page = 1; page <= MAX_PAGES; page++) {
		const results = await fetchPage(lastSeenId);
		console.log(`Page ${page}: ${results.length} results`);

		for (const content of results) {
			const event = toEmbeddingEvent(content);
			if (!event.success) {
				const reasons = event.error.issues
					.map((issue) => `${issue.path.join('.')} ${issue.message}`)
					.join('; ');
				console.log(`Skipping ${content.id}: ${reasons}`);
				continue;
			}
			console.log(
				`${dryRun ? 'Would send' : 'Sending'} ${content.id} (published ${content.webPublicationDate})`,
			);
			if (!dryRun) {
				await sqs.send(
					new SendMessageCommand({
						QueueUrl: queueUrl,
						MessageBody: JSON.stringify(event.data),
					}),
				);
			}
			sent++;
		}

		lastSeenId = results.at(-1)?.id;
		if (!lastSeenId) {
			console.log('No more results');
			break;
		}
	}

	console.log(
		`Finished: sent ${sent} events, last seen ${lastSeenId ?? 'nothing'}`,
	);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
