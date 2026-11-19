import type { TProtocol } from 'thrift';
import { TCompactProtocol, TFramedTransport } from 'thrift';

interface ThriftSerde<T> {
	read(protocol: TProtocol): T;
	write(protocol: TProtocol, value: T): void;
}

/**
 * Crier records and CAPI `format=thrift` responses are both headerless, uncompressed TCompactProtocol structs.
 * Trailing padding after the struct is ignored by the reader.
 */
export function decodeThrift<T>(bytes: Buffer, serde: ThriftSerde<T>): T {
	// TFramedTransport given a buffer reads it directly; no frame-length prefix is expected.
	return serde.read(new TCompactProtocol(new TFramedTransport(bytes)));
}

/** The inverse of `decodeThrift`, mostly useful to build test fixtures. */
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
