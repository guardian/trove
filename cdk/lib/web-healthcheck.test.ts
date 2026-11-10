import assert from 'node:assert/strict';
import type { IncomingMessage, Server } from 'node:http';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, it } from 'node:test';
import { runInNewContext } from 'node:vm';
import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import {
	healthcheckHandler,
	WebFunctionHealthcheck,
} from './web-healthcheck.ts';

interface CfnResponse {
	Status: string;
	Reason: string;
}

const servers: Server[] = [];

afterEach(() => {
	servers.splice(0).forEach((server) => server.close());
});

async function listen(
	handler: Parameters<typeof createServer>[1],
): Promise<string> {
	const server = createServer(handler);
	servers.push(server);
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
	return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

/** Fakes the healthcheck, reporting each build in turn (the last one repeatedly). */
async function fakeApp(...buildIds: string[]): Promise<string> {
	let calls = 0;
	return listen((_, res) => {
		const buildId = buildIds[Math.min(calls++, buildIds.length - 1)];
		res.writeHead(200, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ status: 'ok', buildId }));
	});
}

/** Fakes CloudFormation's pre-signed response URL. */
async function fakeCloudFormation(): Promise<{
	url: string;
	responses: CfnResponse[];
}> {
	const responses: CfnResponse[] = [];
	const url = await listen((req: IncomingMessage, res) => {
		let body = '';
		req.on('data', (chunk: Buffer) => (body += chunk.toString()));
		req.on('end', () => {
			responses.push(JSON.parse(body) as CfnResponse);
			res.end();
		});
	});
	return { url, responses };
}

function event(
	requestType: 'Create' | 'Delete',
	responseUrl: string,
	healthcheckUrl: string,
	timeoutSeconds = '5',
) {
	return {
		RequestType: requestType,
		ResponseURL: responseUrl,
		StackId: 'stack',
		RequestId: 'request',
		LogicalResourceId: 'Check',
		ResourceProperties: {
			Url: healthcheckUrl,
			ExpectedBuildId: '42',
			TimeoutSeconds: timeoutSeconds,
		},
	};
}

void describe('WebFunctionHealthcheck', () => {
	void it('runs as inline Lambda code', async () => {
		const stack = new Stack(new App());
		new WebFunctionHealthcheck(stack, 'Healthcheck', {
			url: 'https://example.com/healthcheck',
			buildId: '42',
		});
		const [fn] = Object.values(
			Template.fromStack(stack).findResources('AWS::Lambda::Function'),
		) as Array<{ Properties: { Code: { ZipFile: string } } }>;
		assert.ok(fn);

		const module = {
			exports: {} as { handler?: (e: unknown) => Promise<void> },
		};
		runInNewContext(fn.Properties.Code.ZipFile, {
			module,
			exports: module.exports,
			fetch,
			AbortSignal,
			setTimeout,
			console,
		});
		assert.ok(module.exports.handler);

		const cfn = await fakeCloudFormation();
		await module.exports.handler(event('Create', cfn.url, await fakeApp('42')));
		assert.equal(cfn.responses[0]?.Status, 'SUCCESS');
	});
});

void describe('healthcheckHandler', () => {
	void it('waits until the new build is serving', async () => {
		const cfn = await fakeCloudFormation();
		const app = await fakeApp('41', '41', '42');

		await healthcheckHandler(event('Create', cfn.url, app), 10);

		assert.equal(cfn.responses.length, 1);
		assert.equal(cfn.responses[0]?.Status, 'SUCCESS');
	});

	void it('fails if the new build never becomes healthy', async () => {
		const cfn = await fakeCloudFormation();
		const app = await listen((_, res) => {
			res.writeHead(500);
			res.end('boom');
		});

		await healthcheckHandler(event('Create', cfn.url, app, '0.2'), 10);

		const [response] = cfn.responses;
		assert.ok(response);
		assert.equal(response.Status, 'FAILED');
		assert.match(response.Reason, /HTTP 500: boom/);
	});

	void it('succeeds immediately on delete', async () => {
		const cfn = await fakeCloudFormation();

		await healthcheckHandler(event('Delete', cfn.url, 'http://127.0.0.1:1'));

		assert.equal(cfn.responses[0]?.Status, 'SUCCESS');
	});
});
