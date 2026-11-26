# trove

Vector search for Guardian articles

## Setup

### Outside devcontainer

1. Install `mise` if you don't have it
2. Run `mise install` to install toolchain from `.tool-versions`
3. Run `npm install` to install node dependencies

### Inside devcontainer

`mise` and the `.tool-versions` toolchain will be installed automatically when the container is created.

You need to run `./scripts/setup.sh`, it will:

- install the tools from `.tool-versions`.
- install the dependencies.
- start the local OpenSearch.
- create the indices and mappings.
- seed the local indices.

## Monorepo structure

We use npm workspaces to manage multiple packages within the repo, and we share Guardian standard tsconfig, eslint and prettier configs across all packages.

You can run commands across all packages from the project root, e.g.:

```sh
npm run format:fix
```

will re-format code across all packages to match Guardian prettier style.

### How to add a new package

- Add its directory to the root `package.json` workspaces list.
- Give it a `package.json` with `"private": true` (unless it will be published),
  `"type": "module"` and package-specific dependencies.
- Extend the root TypeScript configuration and include only the package's sources
  (see the example below).
- Add `"typecheck": "tsc --noEmit"` and a package-appropriate native Node test
  script. Optional local lint/format scripts can invoke the shared tools.
- **Do not duplicate ESLint/Prettier configuration or shared tooling dependencies.**
  Packages that require a different runtime or a bundler should override the
  relevant settings explicitly.

Example package `tsconfig.json`:

```json
{
	"extends": "../tsconfig.json",
	"include": ["src/**/*.ts"]
}
```

## Checking runtime versions

When responding to a vulnerability, `.tool-versions` (e.g. `nodejs 26`) isn't precise enough. To see exact versions, including components bundled in Node such as OpenSSL:

- **Local:** run `./scripts/report-runtime-versions.sh`.
- **CI:** the same script runs after `actions/setup-node` in the job that builds the Lambda artifacts; see the "Runtime versions" table in the job summary, or search the run log for `runtime_versions`.
- **Prod (`trove-listener` and `trove-embedder` Lambdas, `trove-backfill` task):** each cold start (or task start) writes a JSON line with a message like `Runtime versions: node 24.22.2, openssl 3.5.9, arch arm64`, `runtimeVersions.node` / `runtimeVersions.openssl` fields, and the rest of Node's bundled component versions as a single `runtimeVersionsDetail` string. In Central ELK, search for `message:"Runtime versions"`.

## VSCode setup: autolint & autoformat on save

`.vscode/extensions.json` should tell VSCode to prompt you to install our recommended extensions for linting & formatting.

`.vscode/settings.json.default` contains our recommended settings. As per [Guardian recommendations](https://github.com/guardian/recommendations/blob/a8ab16556e32d98784b17f9bc6ac72cd618eb814/VSCode.md#vscodesettingsjson), we do not force these settings on you by committing `settings.json`, but if you want smooth autolinting & autoformatting, we recommend you copy these to `.vscode/settings.json`.
