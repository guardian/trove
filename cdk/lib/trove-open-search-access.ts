import type { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import type { GuLambdaFunction } from '@guardian/cdk/lib/constructs/lambda/index.js';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { CfnAccessPolicy } from 'aws-cdk-lib/aws-opensearchserverless';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import {
	collectionName,
	openSearchParameterNames,
} from './trove-open-search.ts';

/** IAM access to the collection's data plane. What can be done in it is decided by its data access policies. */
export function openSearchApiCallStatement(scope: GuStack): PolicyStatement {
	return new PolicyStatement({
		effect: Effect.ALLOW,
		actions: ['aoss:APICall'],
		resources: [
			StringParameter.valueForStringParameter(
				scope,
				openSearchParameterNames(scope.stage).collectionArn,
			),
		],
	});
}

/** Lets the function write documents to the article indices, but not create them: they come from apply-schema. */
export function grantOpenSearchWrite(
	scope: GuStack,
	fn: GuLambdaFunction,
): void {
	const parameterNames = openSearchParameterNames(scope.stage);
	fn.addEnvironment(
		'OPENSEARCH_ENDPOINT',
		StringParameter.valueForStringParameter(scope, parameterNames.endpoint),
	);
	fn.addToRolePolicy(openSearchApiCallStatement(scope));

	const name = collectionName(scope.stage);
	new CfnAccessPolicy(scope, 'EmbedderDataAccessPolicy', {
		name: `trove-embedder-${scope.stage.toLowerCase()}`,
		type: 'data',
		policy: scope.toJsonString([
			{
				Rules: [
					{
						ResourceType: 'index',
						Resource: [`index/${name}/articles-*`],
						Permission: ['aoss:WriteDocument'],
					},
				],
				Principal: [fn.role?.roleArn],
			},
		]),
	});
}
