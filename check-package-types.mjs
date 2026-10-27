import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const types = JSON.parse(
	execFileSync(
		'npm',
		[
			'pkg',
			'get',
			'type',
			'--workspaces',
			'--include-workspace-root',
			'--json',
		],
		{ cwd: fileURLToPath(new URL('.', import.meta.url)), encoding: 'utf8' },
	),
);

for (const [name, type] of Object.entries(types)) {
	if (type !== 'module') {
		console.error(`${name}: package.json must declare "type": "module".`);
		console.error(
			`(This is something we're trying to enforce for Trove, but if there's a good reason then we can drop the requirement.)`,
		);
		process.exitCode = 1;
	}
}
