import { describe, it } from 'node:test';
import { articleV1Mapping } from './article.ts';

void describe('articleV1Mapping', () => {
	// A change here usually needs a reindex, so update the snapshot deliberately
	void it('matches the snapshot', (context) => {
		context.assert.snapshot(articleV1Mapping);
	});
});
