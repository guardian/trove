import { z } from 'zod';
import type { CapiItem } from './capi.ts';
import { paginateCapi } from './capi.ts';

/**
 * Passed as the Step Function execution input, e.g.
 * { "capiParams": { "from-date": "2020-01-01" }, "startAfterId": "world/2020/jan/01/example" }
 * Unknown keys (like the console's default "Comment") are ignored.
 */
const Input = z.object({
	capiParams: z.record(z.string(), z.string()).default({}),
	startAfterId: z.string().optional(),
	pageSize: z.number().int().min(1).max(200).default(200),
});

const defaultCapiParams = {
	type: 'article',
	'show-fields': 'headline,standfirst,internalRevision',
	'show-tags': 'keyword',
};

// Placeholder for the eventual backfill queue message
const toMessage = (item: CapiItem) => ({
	id: item.id,
	webPublicationDate: item.webPublicationDate,
	headline: item.fields?.headline,
	standfirst: item.fields?.standfirst,
	internalRevision: item.fields?.internalRevision,
	keywordTagIds: item.tags?.map((tag) => tag.id),
});

const main = async () => {
	const apiKey = process.env.CAPI_API_KEY;
	if (!apiKey) {
		throw new Error('CAPI_API_KEY is not set');
	}
	const input = Input.parse(JSON.parse(process.env.BACKFILL_INPUT ?? '{}'));
	console.log(`Starting backfill with input ${JSON.stringify(input)}`);

	let count = 0;
	for await (const page of paginateCapi({
		baseUrl: process.env.CAPI_BASE_URL ?? 'https://content.guardianapis.com',
		apiKey,
		params: { ...defaultCapiParams, ...input.capiParams },
		pageSize: input.pageSize,
		startAfterId: input.startAfterId,
	})) {
		for (const item of page.results) {
			console.log(JSON.stringify(toMessage(item)));
		}
		count += page.results.length;
		// lastSeenId can be passed back in as startAfterId to resume a failed run
		console.log(
			`Progress: count=${count} total=${page.total} lastSeenId=${page.results.at(-1)?.id ?? '-'} url=${page.url}`,
		);
	}
	console.log(`Done: saw ${count} items`);
};

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
