import type { Client, Types } from '@opensearch-project/opensearch';
import { aliasTargets, articleAliases, articleIndices } from './indices.ts';

type AliasAction = Types.Indices_UpdateAliases.Action;

/**
 * Actions that move each alias onto its desired index, and off any other.
 * @param existing alias name -> indices it currently points to
 * @param desired alias name -> index it should point to
 */
export const aliasActions = (
	existing: Record<string, string[]>,
	desired: Record<string, string>,
): AliasAction[] =>
	Object.entries(desired).flatMap(([alias, index]) => {
		const current = existing[alias] ?? [];
		return [
			...current
				.filter((i) => i !== index)
				.map((i) => ({ remove: { index: i, alias } })),
			...(current.includes(index) ? [] : [{ add: { index, alias } }]),
		];
	});

/**
 * Idempotently creates the article indices and points the aliases at them.
 * Never deletes or modifies an existing index: a mapping change means a new version.
 */
export const initSchema = async (client: Client): Promise<void> => {
	for (const version of new Set(Object.values(aliasTargets))) {
		const { name, mapping } = articleIndices[version];
		if ((await client.indices.exists({ index: name })).body) {
			console.log(`Index "${name}" already exists`);
			continue;
		}
		await client.indices.create({
			index: name,
			body: { settings: { index: { knn: true } }, mappings: mapping },
		});
		console.log(`Created index "${name}"`);
	}

	const desired = Object.fromEntries(
		Object.entries(aliasTargets).map(([role, version]) => [
			articleAliases[role as keyof typeof articleAliases],
			articleIndices[version].name,
		]),
	);

	const { body } = await client.indices.getAlias();
	const existing: Record<string, string[]> = {};
	for (const [index, { aliases }] of Object.entries(body)) {
		for (const alias of Object.keys(aliases)) {
			(existing[alias] ??= []).push(index);
		}
	}

	const actions = aliasActions(existing, desired);
	if (actions.length === 0) {
		console.log('Aliases are up to date');
		return;
	}
	// A single request, so aliases switch atomically
	await client.indices.updateAliases({ body: { actions } });
	console.log('Updated aliases', JSON.stringify(actions));
};
