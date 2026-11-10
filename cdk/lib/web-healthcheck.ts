import { createHash } from 'node:crypto';
import { CustomResource, Duration } from 'aws-cdk-lib';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

const checkTimeoutSeconds = 300;

interface HealthcheckEvent {
	RequestType: 'Create' | 'Update' | 'Delete';
	ResponseURL: string;
	StackId: string;
	RequestId: string;
	LogicalResourceId: string;
	PhysicalResourceId?: string;
	ResourceProperties: {
		Url: string;
		ExpectedBuildId: string;
		TimeoutSeconds: string;
	};
}

/**
 * CloudFormation custom resource handler that polls a healthcheck URL until it
 * reports the expected build. It is inlined into the template via
 * `Function.prototype.toString`, so it must be self-contained: no imports or
 * references to anything outside its own body.
 */
export async function healthcheckHandler(
	event: HealthcheckEvent,
	pollIntervalMs = 5000,
): Promise<void> {
	const respond = async (status: 'SUCCESS' | 'FAILED', reason: string) => {
		const response = await fetch(event.ResponseURL, {
			method: 'PUT',
			headers: { 'content-type': '' },
			body: JSON.stringify({
				Status: status,
				Reason: reason.slice(0, 1000),
				PhysicalResourceId:
					event.PhysicalResourceId ?? `${event.LogicalResourceId}-healthcheck`,
				StackId: event.StackId,
				RequestId: event.RequestId,
				LogicalResourceId: event.LogicalResourceId,
			}),
		});
		if (!response.ok) {
			throw new Error(
				`Failed to respond to CloudFormation: ${response.status}`,
			);
		}
	};

	if (event.RequestType === 'Delete') {
		return respond('SUCCESS', 'Nothing to delete');
	}

	const { Url, ExpectedBuildId, TimeoutSeconds } = event.ResourceProperties;
	const deadline = Date.now() + Number(TimeoutSeconds) * 1000;
	let lastResult = 'no attempts made';

	while (Date.now() < deadline) {
		try {
			const response = await fetch(Url, {
				signal: AbortSignal.timeout(10_000),
			});
			const body = await response.text();
			lastResult = `HTTP ${response.status}: ${body.slice(0, 200)}`;
			const { buildId } = response.ok
				? (JSON.parse(body) as { buildId?: string })
				: {};
			if (buildId === ExpectedBuildId) {
				console.log(`Healthy: ${lastResult}`);
				return respond('SUCCESS', `Build ${ExpectedBuildId} is healthy`);
			}
		} catch (error) {
			lastResult = String(error);
		}
		console.log(`Not yet healthy: ${lastResult}`);
		await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
	}

	return respond(
		'FAILED',
		`${Url} did not report healthy build ${ExpectedBuildId} within ${TimeoutSeconds}s. Last result: ${lastResult}`,
	);
}

export interface WebFunctionHealthcheckProps {
	/** URL of a healthcheck that returns JSON including `buildId`. */
	url: string;
	buildId: string;
}

/**
 * Fails the deployment (and so rolls back the stack) unless `url` reports a
 * healthy `buildId`. Make anything that should only change after a successful
 * healthcheck depend on this.
 */
export class WebFunctionHealthcheck extends Construct {
	readonly resource: CustomResource;

	constructor(
		scope: Construct,
		id: string,
		props: WebFunctionHealthcheckProps,
	) {
		super(scope, id);

		const handler = new Function(this, 'Handler', {
			runtime: Runtime.NODEJS_24_X,
			handler: 'index.handler',
			// Inline code keeps this out of the Riff-Raff artifact flow.
			code: Code.fromInline(
				`exports.handler = (event) => (${healthcheckHandler.toString()})(event);`,
			),
			timeout: Duration.seconds(checkTimeoutSeconds + 60),
		});

		// A new logical ID per build means CloudFormation only ever creates or
		// deletes this resource, never updates it. A failed check therefore
		// rolls back by deleting it, without re-running the check.
		const buildHash = createHash('sha256')
			.update(props.buildId)
			.digest('hex')
			.slice(0, 8);

		this.resource = new CustomResource(this, `Check${buildHash}`, {
			serviceToken: handler.functionArn,
			resourceType: 'Custom::WebFunctionHealthcheck',
			properties: {
				Url: props.url,
				ExpectedBuildId: props.buildId,
				TimeoutSeconds: String(checkTimeoutSeconds),
			},
		});
	}
}
