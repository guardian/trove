import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuKinesisLambdaExperimental } from '@guardian/cdk/lib/experimental/patterns/kinesis-lambda.js';
import { StreamRetry } from '@guardian/cdk/lib/utils/lambda/event-source.js';
import type { App } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';

export class Trove extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		new GuKinesisLambdaExperimental(this, 'TroveListener', {
			app: 'trove-listener',
			fileName: 'trove-listener.zip',
			functionName: `trove-listener-${this.stage}`,
			runtime: Runtime.NODEJS_24_X,
			handler: 'index.handler',
			monitoringConfiguration: {
				noMonitoring: true,
			},
			errorHandlingConfiguration: {
				retryBehaviour: StreamRetry.maxAttempts(3),
				bisectBatchOnError: true,
			},
		});
	}
}
