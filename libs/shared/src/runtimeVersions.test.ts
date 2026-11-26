import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { logRuntimeVersions } from './runtimeVersions.ts';

void describe('logRuntimeVersions', () => {
	void it('writes a single top-level JSON line to stdout', () => {
		const write = mock.method(process.stdout, 'write', () => true);
		try {
			logRuntimeVersions();
		} finally {
			write.mock.restore();
		}

		assert.equal(write.mock.callCount(), 1);
		const chunk = String(write.mock.calls[0]?.arguments[0]);
		assert.ok(chunk.endsWith('\n'));
		const { timestamp, ...rest } = JSON.parse(chunk) as Record<string, unknown>;
		assert.equal(typeof timestamp, 'string');
		assert.deepEqual(rest, {
			level: 'INFO',
			message: `Runtime versions: node ${process.versions.node}, openssl ${process.versions.openssl}, arch ${process.arch}`,
			runtimeVersions: {
				node: process.versions.node,
				openssl: process.versions.openssl,
			},
			runtimeVersionsDetail: JSON.stringify(process.versions),
			...(process.env.AWS_EXECUTION_ENV && {
				awsExecutionEnv: process.env.AWS_EXECUTION_ENV,
			}),
			platform: process.platform,
			arch: process.arch,
		});
	});
});
