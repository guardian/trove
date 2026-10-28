import type { GuStackProps } from '@guardian/cdk/lib/constructs/core/index.js';
import { GuStack } from '@guardian/cdk/lib/constructs/core/index.js';
import type { App } from 'aws-cdk-lib';
import { CfnWaitConditionHandle } from 'aws-cdk-lib/aws-cloudformation';

export class Trove extends GuStack {
	constructor(scope: App, id: string, props: GuStackProps) {
		super(scope, id, props);

		// Placeholder: CloudFormation requires at least one resource, so this can be deleted once the stack has real resources
		new CfnWaitConditionHandle(this, 'Placeholder');
	}
}
