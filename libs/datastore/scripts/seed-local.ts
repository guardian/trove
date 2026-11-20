/**
 * Local only: seeds docker-compose OpenSearch with a few documents with random
 * embeddings. Fixed ids make it safe to re-run.
 *
 *   npm run seed-local -w datastore   (or ./scripts/setup.sh from the repo root)
 */
import { ArticleV1 } from '../src/article.ts';
import { createClient } from '../src/client.ts';
import { articleIndices } from '../src/indices.ts';
import { embeddingModels } from '../src/open-search-embeddings.ts';

if (process.env.OPENSEARCH_ENDPOINT) {
	throw new Error(
		'seed-local writes fake articles, so refuses to run against AWS',
	);
}

const client = createClient();

const randomVector = () =>
	Array.from(
		{ length: embeddingModels.marengo_3_0.dimension },
		() => Math.random() * 2 - 1,
	);

const embedded = (value: string) => ({
	value,
	embeddings: { marengo_3_0: randomVector() },
});

const article = (
	headline: string,
	standfirst: string | undefined,
	sectionId: string,
	bodyTextPreview: string,
	toneTagIds: string[],
	keywordTagIds: string[],
) =>
	ArticleV1.parse({
		headline: embedded(headline),
		byline: 'A Reporter',
		articleType: 'article',
		sectionId,
		pillarId:
			sectionId === 'sport' || sectionId === 'football' ? 'sport' : 'news',
		...(standfirst === undefined ? {} : { standfirst: embedded(standfirst) }),
		headlineAndStandfirst: embedded(
			standfirst === undefined ? headline : `${headline}\n${standfirst}`,
		),
		bodyTextPreview: embedded(bodyTextPreview),
		toneTagIds,
		keywordTagIds,
		internalRevision: Math.floor(Math.random() * 10_000),
		wordCount: bodyTextPreview.split(/\s+/).length,
		storedAt: new Date().toISOString(),
		webPublicationDate: '2026-10-26T10:00:00Z',
		firstPublicationDate: '2026-10-26T09:00:00Z',
	});

const samples: Record<string, ArticleV1> = {
	'world/2026/oct/26/lula-wins-brazil-election': article(
		'Lula wins Brazil election',
		'Incumbent secures another term after a tight run-off',
		'world',
		"Lula has won Brazil's presidential election after a close run-off.",
		['tone/news'],
		['world/brazil', 'world/luiz-inacio-lula-da-silva'],
	),
	'food/2026/oct/20/cucumber-salad-recipe': article(
		'The only cucumber salad you need',
		'Crunchy, sharp and ready in ten minutes',
		'food',
		'This crisp cucumber salad is ready in ten minutes.',
		['tone/recipes'],
		['food/cucumber', 'food/salad'],
	),
	'sport/2026/oct/25/premier-league-roundup': article(
		'Premier League roundup',
		undefined,
		'sport',
		'All the goals and talking points from the weekend.',
		['tone/comment'],
		['sport/premierleague', 'football/football'],
	),
};

const index = articleIndices.v1.name;
if (!(await client.indices.exists({ index })).body) {
	throw new Error(`Index "${index}" is missing, run apply-schema first`);
}

const { body: bulk } = await client.bulk({
	refresh: true,
	body: Object.entries(samples).flatMap(([id, doc]) => [
		{ index: { _index: index, _id: id } },
		doc,
	]),
});
if (bulk.errors) {
	throw new Error(JSON.stringify(bulk.items, null, 2));
}
console.log(`Indexed ${bulk.items.length} documents into ${index}`);
