import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { createTroveWebServer, parseListenAddress } from './server.ts';

void describe('parseListenAddress', () => {
	void it('uses the host and port that Lambda provides', () => {
		assert.deepEqual(parseListenAddress('127.0.0.1:9001'), {
			host: '127.0.0.1',
			port: 9001,
		});
	});

	void it('falls back to localhost:3000 for local runs', () => {
		assert.deepEqual(parseListenAddress(undefined), {
			host: 'localhost',
			port: 3000,
		});
	});
});

void describe('trove-web server', () => {
	const server = createTroveWebServer('42 (abc123)');
	let baseUrl: string;

	before(async () => {
		await new Promise<void>((resolve) =>
			server.listen(0, '127.0.0.1', resolve),
		);
		const { port } = server.address() as AddressInfo;
		baseUrl = `http://127.0.0.1:${port}`;
	});

	after(() => {
		server.close();
	});

	void it('responds to the healthcheck', async () => {
		const response = await fetch(`${baseUrl}/healthcheck`);
		assert.equal(response.status, 200);
		const json = (await response.json()) as {
			status: string;
			buildId: string;
		};
		assert.equal(json.status, 'ok');
		assert.equal(json.buildId, '42 (abc123)');
	});

	void it('returns 404 for unknown paths', async () => {
		const response = await fetch(`${baseUrl}/nope`);
		assert.equal(response.status, 404);
	});
});
