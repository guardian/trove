import type { Server } from 'node:http';
import { createServer } from 'node:http';

/** `buildId` lets the deploy healthcheck confirm that the new revision is serving. */
export function createTroveWebServer(buildId: string): Server {
	return createServer((req, res) => {
		if (req.method === 'GET' && req.url === '/healthcheck') {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify({ status: 'ok', buildId }));
			return;
		}
		res.writeHead(404, { 'content-type': 'application/json' });
		res.end(JSON.stringify({ error: 'Not found' }));
	});
}

/** Lambda Web Functions supply the address to listen on as `host:port`. */
export function parseListenAddress(endpoint: string | undefined): {
	host: string;
	port: number;
} {
	const [host = 'localhost', port = '3000'] = (
		endpoint ?? 'localhost:3000'
	).split(':');
	return { host, port: Number(port) };
}
