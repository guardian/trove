This project is a TypeScript monorepo, using npm workspaces. When making changes to the packages, reference the root README.md for more information.

Lambda deploys depend on a naming contract between the CDK app/fileName, the packaged ZIP and the workflow's contentDirectories. Use the add-gu-lambda skill when adding or renaming a Lambda.

Code style is enforced using a shared eslint and prettier config. When making changes, please use `npm run typecheck`, `npm run lint:fix` and `npm run format:fix` as appropriate.
