# trove

Vector search for Guardian articles

## Node packages

Use Node.js 26, as selected by `.tool-versions` and required by the root
`package.json`. Run `npm ci` from the repository root to install all workspaces.

Run shared checks from the repository root:

```sh
npm run typecheck
npm run lint:check
npm run lint:fix
npm test
npm run format:check
npm run format:fix
```

### Adding a Node package

- Add its directory to the root `package.json` workspaces list.
- Give it a `package.json` with `"private": true` (unless it will be published),
  `"type": "module"` and package-specific dependencies.
- Extend the root TypeScript configuration and include only the package's sources
  (see the example below).
- Add `"typecheck": "tsc --noEmit"` and a package-appropriate native Node test
  script. Optional local lint/format scripts can invoke the shared tools.
- Do not duplicate ESLint/Prettier configuration or shared tooling dependencies.
  Packages that require a different runtime or a bundler should override the
  relevant settings explicitly.

Example package `tsconfig.json`:

```json
{
	"extends": "../tsconfig.json",
	"include": ["src/**/*.ts"]
}
```

### VSCode setup: autolint & autoformat on save

`.vscode/extensions.json` should tell VSCode to prompt you to install our recommended extensions for linting & formatting.

`.vscode/settings.json.default` contains our recommended settings. As per [Guardian recommendations](https://github.com/guardian/recommendations/blob/a8ab16556e32d98784b17f9bc6ac72cd618eb814/VSCode.md#vscodesettingsjson), we do not force these settings on you by committing `settings.json`, but if you want smooth autolinting & autoformatting, we recommend you copy these to `.vscode/settings.json`.
