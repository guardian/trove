import { TCompactProtocol, TFramedTransport } from 'thrift';
import type { ThriftSerde } from '../thrift.ts';

/** The inverse of `decodeThrift`, to build test fixtures. */
export function encodeThrift<T>(value: T, serde: ThriftSerde<T>): Buffer {
	let framed: Buffer = Buffer.alloc(0);
	const transport = new TFramedTransport(undefined, (buffer?: Buffer) => {
		if (buffer) {
			framed = buffer;
		}
	});
	serde.write(new TCompactProtocol(transport), value);
	transport.flush();
	// TFramedTransport.flush prepends a 4-byte length, which Crier and CAPI payloads don't have.
	return framed.subarray(4);
}
