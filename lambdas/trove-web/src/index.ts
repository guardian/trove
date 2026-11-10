import { createTroveWebServer, parseListenAddress } from './server.ts';

const { host, port } = parseListenAddress(process.env.AWS_LAMBDA_HTTP_ENDPOINT);
const server = createTroveWebServer(process.env.BUILD_ID ?? 'DEV');

server.listen(port, host, () => {
	console.log(`trove-web listening on ${host}:${port}`);
});

process.on('SIGTERM', () => {
	server.close();
});
