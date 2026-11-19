import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

const ssm = new SSMClient({});

export async function getParameter(name: string): Promise<string> {
	const { Parameter } = await ssm.send(
		new GetParameterCommand({ Name: name, WithDecryption: true }),
	);
	if (!Parameter?.Value) {
		throw new Error(`SSM parameter ${name} has no value`);
	}
	return Parameter.Value;
}
