import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { aliasActions } from './apply-schema.ts';

const desired = {
	'articles-current': 'articles-v1',
	'articles-next': 'articles-v1',
};

void describe('aliasActions', () => {
	void it('adds every alias on a fresh cluster', () => {
		assert.deepEqual(aliasActions({}, desired), [
			{ add: { index: 'articles-v1', alias: 'articles-current' } },
			{ add: { index: 'articles-v1', alias: 'articles-next' } },
		]);
	});

	void it('does nothing when aliases are up to date', () => {
		assert.deepEqual(
			aliasActions(
				{
					'articles-current': ['articles-v1'],
					'articles-next': ['articles-v1'],
				},
				desired,
			),
			[],
		);
	});

	void it('moves an alias off its previous index', () => {
		assert.deepEqual(
			aliasActions(
				{
					'articles-current': ['articles-v1'],
					'articles-next': ['articles-v1'],
				},
				{ 'articles-current': 'articles-v1', 'articles-next': 'articles-v2' },
			),
			[
				{ remove: { index: 'articles-v1', alias: 'articles-next' } },
				{ add: { index: 'articles-v2', alias: 'articles-next' } },
			],
		);
	});
});
