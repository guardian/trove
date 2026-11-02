import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const readPackageJson = (dir) =>
	JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8'));

const rootPackageJson = readPackageJson('.');

// Workspace entries may be globs (e.g. "lambdas/*"), so expand them to package directories
const workspaceDirs = (rootPackageJson.workspaces ?? []).flatMap((pattern) =>
	globSync(join(pattern, 'package.json'), { cwd: root }).map((file) =>
		join(file, '..'),
	),
);

/**
 * We want to make sure that all packages in the workspace declare "type": "module" in their package.json files
 * in order to get consistent handling by eslint. This script is run alongside linting to enforce this requirement.
 * If there's ever a compelling reason to not use "type": "module", we can change or drop this script.
 */
for (const dir of ['.', ...workspaceDirs]) {
	const { name, type } = readPackageJson(dir);
	if (type !== 'module') {
		console.error(
			`${name ?? dir}: package.json must declare "type": "module".`,
		);
		console.error(
			`(This is something we're trying to enforce for Trove, but if there's a good reason then we can drop the requirement.)`,
		);
		process.exitCode = 1;
	}
}
