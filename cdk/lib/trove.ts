import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import type { GuKinesisLambdaProps } from '@guardian/cdk/lib/experimental/patterns/kinesis-lambda.js';
import { GuKinesisLambdaExperimental } from '@guardian/cdk/lib/experimental/patterns/kinesis-lambda.js';
import { StreamRetry } from '@guardian/cdk/lib/utils/lambda/event-source.js';
import type { App } from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';

export class Trove extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		new GuKinesisLambdaExperimental(this, 'TroveListener', {
			app: 'trove-listener',
			fileName: 'trove-listener.zip',
			functionName: `trove-listener-${this.stage}`,
			runtime: Runtime.NODEJS_24_X,
			handler: 'index.handler',
			monitoringConfiguration: getMonitoringConfiguration(this, this.stage),
			errorHandlingConfiguration: {
				retryBehaviour: StreamRetry.maxAttempts(3),
				bisectBatchOnError: true,
			},
			existingKinesisStream: {
				externalKinesisStreamName: `content-api-firehose-v2-${this.stage}`,
			},
			processingProps: {
				startingPosition: StartingPosition.LATEST,
				batchSize: 1,
				maxBatchingWindow: Duration.seconds(10),
			},
		});
	}
}

function getMonitoringConfiguration(
	scope: GuStack,
	stage: string,
): GuKinesisLambdaProps['monitoringConfiguration'] {
	if (!['PROD', 'TEST'].includes(stage)) {
		return { noMonitoring: true };
	}
	const alarmSnsTopic = new Topic(scope, `trove-email-alarm-topic`);
	alarmSnsTopic.addSubscription(
		new EmailSubscription('ai.dev+alerts@guardian.co.uk'),
	);
	return {
		snsTopicName: alarmSnsTopic.topicName,
		toleratedErrorPercentage: 0,
	};
}
