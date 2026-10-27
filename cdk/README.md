# Infrastructure

This directory defines the components to be deployed to AWS.

See [`package.json`](./package.json) for a list of available scripts.

The CDK app and tests run TypeScript directly on Node.js 26; no compilation or
`ts-node` loader is needed. TypeScript, ESLint and Prettier settings are shared
from the repository root (see [Node packages](../README.md#node-packages)).

Run `npm run synth --workspace cdk` from the repository root to synthesize the app,
or `npm run typecheck --workspace cdk` to check types without emitting JavaScript.

Tests use Node.js 26's built-in test runner. From the repository root, run
`npm test --workspace cdk` to check snapshots or `npm run test-update --workspace cdk`
to update them. Review snapshot changes before committing.
