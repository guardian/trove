import express, { type Express, type Request, type Response } from 'express';
import serverless from 'serverless-http';
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';

const PORT = 3000;

function createExpressApp() {
	const app: Express = express();
	app.get('/healthcheck', (req: Request, res: Response) => {
		res.send('OK');
	});
	return app;
}

function isRunningInAWS(): boolean {
	return process.env['AWS_EXECUTION_ENV'] !== undefined;
}

if (!isRunningInAWS()) {
	// We're running locally
	const app = createExpressApp();

	console.log('Local dev express app has been created');

	app.listen(PORT, () => {
		console.log(`Local dev API listening on port ${PORT}`);
	});
}

// We use serverless-http rather than @codegenie/serverless-express because
// the latter marks the request stream as unreadable as soon as the
// synchronous part of the middleware chain has run, which breaks
// express.json() when it runs after async middleware such as authenticate.
// See https://github.com/CodeGenieApp/serverless-express/issues/693
let serverlessHandler: serverless.Handler | undefined;

function serverlessSetup(event: APIGatewayProxyEvent, context: Context) {
	const app = createExpressApp();
	console.log('Created express app');

	serverlessHandler = serverless(app);
	console.log('Created serverless-http handler');

	return serverlessHandler(event, context);
}

function handler(event: APIGatewayProxyEvent, context: Context) {
	if (serverlessHandler) {
		console.log('Re-using existing serverless-http handler');
		return serverlessHandler(event, context);
	}
	console.log('No existing serverless-http handler, creating');
	return serverlessSetup(event, context);
}

export { handler, createExpressApp };
