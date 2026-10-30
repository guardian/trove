---
name: add-gu-lambda
description: Add, rename or change the packaging of a GuLambdaFunction deployed via GuCDK-generated Riff-Raff config. Covers the app/fileName/contentDirectories naming contract, ZIP packaging and the build workflow.
---

## Adding a Lambda

Applies to Lambdas declared with `GuLambdaFunction` and deployed using the Riff-Raff manifest that GuCDK generates (`cdk/cdk.out/riff-raff.yaml`).

### Naming contract

These values must match exactly:

| Value                                            | CDK `GuLambdaFunction` prop | Build output                                | Workflow `contentDirectories` |
| ------------------------------------------------ | --------------------------- | ------------------------------------------- | ----------------------------- |
| App, e.g. `my-project-article-worker` (no stage) | `app`                       | —                                           | key                           |
| ZIP, e.g. `article-worker.zip`                   | `fileName`                  | ZIP filename                                | listed file                   |
| Entry point, e.g. `index.handler`                | `handler`                   | `index.js` at ZIP root, exporting `handler` | —                             |

Riff-Raff finds the deployed function by its `App`, `Stack` and `Stage` tags, so **each Lambda needs a unique `app`**. These values are not part of the contract:

- The construct ID (`'ArticleWorker'`) is only a CDK ID.
- `functionName` is only the physical AWS name. Include the stage in it so that names are unique across stages.

### Steps

1. **Declare** the Lambda in CDK:

   ```ts
   new GuLambdaFunction(this, 'ArticleWorker', {
   	app: 'my-project-article-worker',
   	fileName: 'article-worker.zip',
   	functionName: `my-project-${this.stage}-article-worker`,
   	runtime: Runtime.NODEJS_22_X,
   	handler: 'index.handler',
   });
   ```

2. **Build and package.** Bundle the handler and all its dependencies into `dist/index.js`. Only `@aws-sdk/*` v3 may stay external. Then zip it from inside `dist`, so `index.js` is at the archive root:

   ```sh
   cd dist && zip article-worker.zip index.js
   ```

3. **Upload.** In the build workflow, run the build, package and `npm run synth -w cdk` steps before `guardian/actions-riff-raff`. Then add this entry to its `contentDirectories`:

   ```yaml
   my-project-article-worker:
     - path/to/dist/article-worker.zip
   ```

4. **Verify.** Run `npm run synth -w cdk` and check that `cdk/cdk.out/riff-raff.yaml` includes `lambda-upload-…` and `lambda-update-…` deployments with:

   ```yaml
   app: my-project-article-worker
   contentDirectory: my-project-article-worker
   parameters:
     fileName: article-worker.zip
     lookupByTags: true
   ```

   Never edit the generated manifest by hand. If there are CDK snapshot tests, update them.
