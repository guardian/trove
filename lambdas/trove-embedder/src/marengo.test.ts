import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { InvokeModelCommandInput } from '@aws-sdk/client-bedrock-runtime';
import type { InvokeModel } from './marengo.ts';
import { createMarengoEmbedder } from './marengo.ts';

const vector = Array.from({ length: 512 }, (_, i) => i / 512);

const fakeInvoke = (
	response: unknown,
	calls: InvokeModelCommandInput[] = [],
): InvokeModel => {
	return (input) => {
		calls.push(input);
		return Promise.resolve({
			body: new TextEncoder().encode(JSON.stringify(response)),
		});
	};
};

void describe('createMarengoEmbedder', () => {
	void it('sends a text request to the Marengo inference profile', async () => {
		const calls: InvokeModelCommandInput[] = [];
		await createMarengoEmbedder(
			fakeInvoke({ data: { embedding: vector } }, calls),
		)('Some headline');

		assert.equal(calls.length, 1);
		assert.equal(calls[0]?.modelId, 'eu.twelvelabs.marengo-embed-3-0-v1:0');
		assert.deepEqual(JSON.parse(calls[0].body as string), {
			inputType: 'text',
			text: { inputText: 'Some headline' },
		});
	});

	void it('returns the embedding from an object response', async () => {
		const embed = createMarengoEmbedder(
			fakeInvoke({ data: { embedding: vector } }),
		);
		assert.deepEqual(await embed('text'), vector);
	});

	void it('returns the embedding from a single-item list response', async () => {
		const embed = createMarengoEmbedder(
			fakeInvoke({ data: [{ embedding: vector }] }),
		);
		assert.deepEqual(await embed('text'), vector);
	});

	void it('rejects an embedding with the wrong dimension', async () => {
		const embed = createMarengoEmbedder(
			fakeInvoke({ data: { embedding: [0.1, 0.2] } }),
		);
		await assert.rejects(embed('text'));
	});

	void it('rejects a response with several embeddings', async () => {
		const embed = createMarengoEmbedder(
			fakeInvoke({ data: [{ embedding: vector }, { embedding: vector }] }),
		);
		await assert.rejects(embed('text'));
	});
});
