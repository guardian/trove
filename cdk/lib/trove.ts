import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuLambdaFunction } from '@guardian/cdk/lib/constructs/lambda/index.js';
import type { GuKinesisLambdaProps } from '@guardian/cdk/lib/experimental/patterns/kinesis-lambda.js';
import { GuKinesisLambdaExperimental } from '@guardian/cdk/lib/experimental/patterns/kinesis-lambda.js';
import { StreamRetry } from '@guardian/cdk/lib/utils/lambda/event-source.js';
import type { App } from 'aws-cdk-lib';
import { Duration } from 'aws-cdk-lib';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { StartingPosition } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import { Topic } from 'aws-cdk-lib/aws-sns';
import { EmailSubscription } from 'aws-cdk-lib/aws-sns-subscriptions';
import { Queue } from 'aws-cdk-lib/aws-sqs';

export class Trove extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		const listener = new GuKinesisLambdaExperimental(this, 'TroveListener', {
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

		const liveQueue = createQueueWithDLQ(this, 'EmbedderLive');
		const backfillQueue = createQueueWithDLQ(this, 'EmbedderBackfill');

		liveQueue.grantSendMessages(listener);
		listener.addEnvironment('LIVE_EMBEDDER_QUEUE_URL', liveQueue.queueUrl);

		// A single function fed by both queues, so throughput can be throttled at the function level
		const embedder = new GuLambdaFunction(this, 'TroveEmbedder', {
			app: 'trove-embedder',
			fileName: 'trove-embedder.zip',
			functionName: `trove-embedder-${this.stage}`,
			runtime: Runtime.NODEJS_24_X,
			handler: 'index.handler',
		});
		embedder.addEventSource(new SqsEventSource(liveQueue));
		embedder.addEventSource(new SqsEventSource(backfillQueue));
	}
}

function createQueueWithDLQ(scope: GuStack, id: string): Queue {
	const deadLetterQueue = new Queue(scope, `${id}DeadLetterQueue`, {
		retentionPeriod: Duration.days(14),
	});
	return new Queue(scope, `${id}Queue`, {
		deadLetterQueue: { queue: deadLetterQueue, maxReceiveCount: 3 },
	});
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
