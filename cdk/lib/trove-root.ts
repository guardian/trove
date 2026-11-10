import { RiffRaffYamlFile } from '@guardian/cdk/lib/riff-raff-yaml-file/index.js';
import type { StageSynthesisOptions } from 'aws-cdk-lib';
import { App } from 'aws-cdk-lib';
import type { CloudAssembly } from 'aws-cdk-lib/cx-api';
import { addBackfillTaskDeployment } from './backfill-task.ts';
import { Trove } from './trove.ts';

/**
 * Equivalent to GuRoot, but also adds Riff-Raff deployments that GuCDK
 * can't infer from the stacks.
 *
 * @see https://github.com/guardian/cdk/blob/main/src/constructs/root.ts
 */
export class TroveRoot extends App {
	override synth(options?: StageSynthesisOptions): CloudAssembly {
		const cloudAssembly = super.synth(options);
		const riffRaff = new RiffRaffYamlFile(this);
		const troveStacks = this.node.children.filter((c) => c instanceof Trove);
		addBackfillTaskDeployment(riffRaff, troveStacks);
		riffRaff.synth();
		return cloudAssembly;
	}
}
