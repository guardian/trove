import { describe, it } from 'node:test';
import { articleMapping } from './article.ts';

void describe('articleMapping', () => {
	// A change here usually needs a reindex, so update the snapshot deliberately
	void it('matches the snapshot', (context) => {
		context.assert.snapshot(articleMapping);
	});
});
