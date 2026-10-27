import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import type { App } from 'aws-cdk-lib';
import { RemovalPolicy } from 'aws-cdk-lib';
import type { CfnCollectionGroupProps } from 'aws-cdk-lib/aws-opensearchserverless';
import {
	CfnCollection,
	CfnCollectionGroup,
	CfnSecurityPolicy,
} from 'aws-cdk-lib/aws-opensearchserverless';

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

export class TroveOpenSearch extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		const { stage } = this;
		if (stage !== 'CODE' && stage !== 'PROD') {
			throw new Error(`Unsupported stage: ${stage}`);
		}

		const name = `trove-${stage.toLowerCase()}`;
		const collectionResource = `collection/${name}`;

		const encryptionPolicy = new CfnSecurityPolicy(this, 'EncryptionPolicy', {
			name: `${name}-encryption`,
			type: 'encryption',
			policy: JSON.stringify({
				Rules: [{ ResourceType: 'collection', Resource: [collectionResource] }],
				AWSOwnedKey: true,
			}),
		});

		// Public endpoint: access is still gated by IAM and data access policies
		const networkPolicy = new CfnSecurityPolicy(this, 'NetworkPolicy', {
			name: `${name}-network`,
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
	}
}
