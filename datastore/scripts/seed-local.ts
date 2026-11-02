/**
 * Throw-away script: recreates the articles index on the local docker-compose
 * OpenSearch and seeds it with a few documents using random embeddings.
 *
 *   npm run seed -w datastore
 */
import {
	Article,
	articleMapping,
	ARTICLES_INDEX,
	embeddingModels,
} from '../src/article.ts';
import { createClient } from '../src/client.ts';

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
	standfirst: string,
	keywordTagIds: string[],
) =>
	Article.parse({
		headline: embedded(headline),
		standfirst: embedded(standfirst),
		headlineAndStandfirst: embedded(`${headline}\n${standfirst}`),
		keywordTagIds,
		internalRevision: Math.floor(Math.random() * 10_000),
		storedAt: new Date().toISOString(),
	});

const samples: Record<string, Article> = {
	'world/2026/oct/26/lula-wins-brazil-election': article(
		'Lula wins Brazil election',
		'Incumbent secures another term after a tight run-off',
		['world/brazil', 'world/luiz-inacio-lula-da-silva'],
	),
	'food/2026/oct/20/cucumber-salad-recipe': article(
		'The only cucumber salad you need',
		'Crunchy, sharp and ready in ten minutes',
		['food/cucumber', 'food/salad'],
	),
	'sport/2026/oct/25/premier-league-roundup': article(
		'Premier League roundup',
		'All the goals and talking points from the weekend',
		['sport/premierleague', 'football/football'],
	),
};

if ((await client.indices.exists({ index: ARTICLES_INDEX })).body) {
	await client.indices.delete({ index: ARTICLES_INDEX });
}
await client.indices.create({
	index: ARTICLES_INDEX,
	body: { settings: { index: { knn: true } }, mappings: articleMapping },
});
console.log(`Created index "${ARTICLES_INDEX}"`);

const { body: bulk } = await client.bulk({
	refresh: true,
	body: Object.entries(samples).flatMap(([id, doc]) => [
		{ index: { _index: ARTICLES_INDEX, _id: id } },
		doc,
	]),
});
if (bulk.errors) {
	throw new Error(JSON.stringify(bulk.items, null, 2));
}
console.log(`Indexed ${bulk.items.length} documents`);

// Embeddings are excluded from search results, so parse with a schema that omits them
const textOnly = Article.shape.headline.omit({ embeddings: true });
const SearchHit = Article.extend({
	headline: textOnly,
	standfirst: textOnly,
	headlineAndStandfirst: textOnly,
});

const { body: search } = await client.search({
	index: ARTICLES_INDEX,
	body: {
		size: 3,
		_source: { excludes: ['*.embeddings'] },
		query: {
			knn: {
				'headlineAndStandfirst.embeddings.marengo_3_0': {
					vector: randomVector(),
					k: 3,
				},
			},
		},
	},
});
for (const hit of search.hits.hits) {
	const doc = SearchHit.parse(hit._source);
	console.log(hit._score?.toFixed(3), hit._id, doc.headline.value);
}
