import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuDeveloperPolicy } from '@guardian/cdk/lib/constructs/iam/index.js';
import type { App } from 'aws-cdk-lib';
import { RemovalPolicy } from 'aws-cdk-lib';
import { Effect, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import type { CfnCollectionGroupProps } from 'aws-cdk-lib/aws-opensearchserverless';
import {
	CfnAccessPolicy,
	CfnCollection,
	CfnCollectionGroup,
	CfnSecurityPolicy,
} from 'aws-cdk-lib/aws-opensearchserverless';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';

type CapacityLimits = NonNullable<CfnCollectionGroupProps['capacityLimits']>;

// Scale to zero when idle; the max is a cost cap
const capacityLimitsByStage: Record<'CODE' | 'PROD', CapacityLimits> = {
	CODE: {
		minIndexingCapacityInOcu: 0,
		minSearchCapacityInOcu: 0,
		maxIndexingCapacityInOcu: 4,
		maxSearchCapacityInOcu: 4,
	},
	PROD: {
		minIndexingCapacityInOcu: 0,
		minSearchCapacityInOcu: 0,
		maxIndexingCapacityInOcu: 8,
		maxSearchCapacityInOcu: 8,
	},
};

type TroveOpenSearchProps = GuStackProps & {
	stage: 'CODE' | 'PROD';
};

export class TroveOpenSearch extends GuStack {
	constructor(scope: App, id: string, props: TroveOpenSearchProps) {
		super(scope, id, props);

		const stage = props.stage;

		const name = `trove-${stage.toLowerCase()}`;
		const collectionResource = `collection/${name}`;

		const encryptionPolicy = new CfnSecurityPolicy(this, 'EncryptionPolicy', {
			name: `trove-encryption-${stage.toLowerCase()}`,
			type: 'encryption',
			policy: JSON.stringify({
				Rules: [{ ResourceType: 'collection', Resource: [collectionResource] }],
				AWSOwnedKey: true,
			}),
		});

		// Public endpoint: access is still gated by IAM and data access policies
		const networkPolicy = new CfnSecurityPolicy(this, 'NetworkPolicy', {
			name: `trove-network-${stage.toLowerCase()}`,
			type: 'network',
			policy: JSON.stringify([
				{
					Rules: [
						{ ResourceType: 'collection', Resource: [collectionResource] },
						{ ResourceType: 'dashboard', Resource: [collectionResource] },
					],
					// this cluster only contains data that is publicly available
					// a tight IAM should be simpler than having to handle VPCs
					AllowFromPublic: true,
				},
			]),
		});

		const group = new CfnCollectionGroup(this, 'CollectionGroup', {
			name,
			generation: 'NEXTGEN',
			standbyReplicas: 'ENABLED',
			capacityLimits: capacityLimitsByStage[stage],
		});
		group.applyRemovalPolicy(RemovalPolicy.RETAIN);

		const collection = new CfnCollection(this, 'Collection', {
			name,
			type: 'VECTORSEARCH',
			collectionGroupName: group.name,
			standbyReplicas: 'ENABLED',
			deletionProtection: 'ENABLED',
		});
		collection.addResourceDependency(encryptionPolicy);
		collection.addResourceDependency(networkPolicy);
		collection.addResourceDependency(group);
		collection.applyRemovalPolicy(RemovalPolicy.RETAIN);

		// Granted through Janus, to run `npm run init-schema -w datastore` locally
		new GuDeveloperPolicy(this, 'OpenSearchAdminPolicy', {
			grantId: 'trove-opensearch-admin',
			friendlyName: 'Manage Trove OpenSearch indices',
			statements: [
				new PolicyStatement({
					effect: Effect.ALLOW,
					actions: ['aoss:APIAccessAll'],
					resources: [collection.attrArn],
				}),
			],
		});

		// Janus sessions run as the account's federation role, narrowed down by the developer policy above
		const janusFederationRoleArn = StringParameter.valueForStringParameter(
			this,
			'/account/services/janus/federation-role-arn',
		);

		new CfnAccessPolicy(this, 'DataAccessPolicy', {
			name: `trove-data-${stage.toLowerCase()}`,
			type: 'data',
			policy: this.toJsonString([
				{
					Rules: [
						{
							ResourceType: 'collection',
							Resource: [collectionResource],
							Permission: [
								'aoss:CreateCollectionItems',
								'aoss:DescribeCollectionItems',
								'aoss:UpdateCollectionItems',
							],
						},
						{
							ResourceType: 'index',
							Resource: [`index/${name}/articles-*`],
							Permission: [
								'aoss:CreateIndex',
								'aoss:DescribeIndex',
								'aoss:UpdateIndex',
								'aoss:ReadDocument',
								'aoss:WriteDocument',
							],
						},
					],
					Principal: [janusFederationRoleArn],
				},
			]),
		});
	}
}
