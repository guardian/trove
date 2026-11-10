import { TroveRoot } from '../lib/riff-raff.ts';
import { TroveOpenSearch } from '../lib/trove-open-search.ts';
import { TroveWeb, TroveWebArtifacts } from '../lib/trove-web.ts';
import { Trove } from '../lib/trove.ts';

const app = new TroveRoot();

// Set by GitHub Actions; matches the build number Riff-Raff shows.
const buildId = process.env.GITHUB_RUN_NUMBER
	? `${process.env.GITHUB_RUN_NUMBER} (${process.env.GITHUB_SHA ?? 'unknown'})`
	: 'DEV';

for (const stage of ['CODE', 'PROD'] as const) {
	const env = { region: 'eu-west-1' };
	new Trove(app, `Trove-euwest-1-${stage}`, {
		stack: 'content-api',
		stage,
		env,
	});
	new TroveOpenSearch(app, `TroveOpenSearch-euwest-1-${stage}`, {
		stack: 'content-api',
		stage,
		env,
	});
	const artifacts = new TroveWebArtifacts(
		app,
		`TroveWebArtifacts-euwest-1-${stage}`,
		{ stack: 'content-api', stage, env },
	);
	const web = new TroveWeb(app, `TroveWeb-euwest-1-${stage}`, {
		stack: 'content-api',
		stage,
		env,
		buildId,
	});
	web.addStackDependency(artifacts);
}
