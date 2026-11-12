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
	// Empty means start from the oldest content (the Step Function input always sets it)
	let lastSeenId =
		process.env.LAST_SEEN_ID === '' ? undefined : process.env.LAST_SEEN_ID;
	let sent = 0;

	console.log(
		`Starting backfill after ${lastSeenId ?? 'the oldest content'}, ` +
			`${MAX_PAGES} pages of ${PAGE_SIZE}${dryRun ? ' (dry run, nothing will be sent)' : ''}`,
	);

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

		const last = results.at(-1);
		if (!last) {
			console.log('No more results');
			break;
		}
		lastSeenId = last.id;
	}

	console.log(
		`Finished: sent ${sent} events, last seen ${lastSeenId ?? 'none'}`,
	);
}

main().catch((error: unknown) => {
	console.error(error);
	process.exit(1);
});
