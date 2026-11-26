import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import { awsClientConfig } from './aws.ts';

const ssm = new SSMClient(awsClientConfig);
const parameters = new Map<string, Promise<string>>();

export function getSsmParameter(name: string): Promise<string> {
	let parameter = parameters.get(name);
	if (!parameter) {
		parameter = ssm
			.send(new GetParameterCommand({ Name: name, WithDecryption: true }))
			.then(({ Parameter }) => {
				if (!Parameter?.Value) {
					throw new Error(`SSM parameter ${name} has no value`);
				}
				return Parameter.Value;
			})
			.catch((error: unknown) => {
				parameters.delete(name);
				throw error;
			});
		parameters.set(name, parameter);
	}
	return parameter;
}
