import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GetParameterCommand } from '@aws-sdk/client-ssm';
import { SSMClient } from '@aws-sdk/client-ssm';
import { getSsmParameter } from './ssm.ts';

void describe('getSsmParameter', () => {
	void it('decrypts and caches successful lookups', async (t) => {
		const send = t.mock.method(SSMClient.prototype, 'send', () =>
			Promise.resolve({ Parameter: { Value: 'key' } }),
		);

		assert.equal(await getSsmParameter('/test/cached'), 'key');
		assert.equal(await getSsmParameter('/test/cached'), 'key');
		assert.equal(send.mock.callCount(), 1);
		const command = send.mock.calls[0]?.arguments[0] as GetParameterCommand;
		assert.deepStrictEqual(command.input, {
			Name: '/test/cached',
			WithDecryption: true,
		});
	});

	void it('retries a lookup after a failure', async (t) => {
		let attempts = 0;
		t.mock.method(SSMClient.prototype, 'send', () => {
			attempts++;
			return attempts === 1
				? Promise.reject(new Error('temporary failure'))
				: Promise.resolve({ Parameter: { Value: 'key' } });
		});

		await assert.rejects(getSsmParameter('/test/retry'), /temporary failure/);
		assert.equal(await getSsmParameter('/test/retry'), 'key');
		assert.equal(attempts, 2);
	});
});
