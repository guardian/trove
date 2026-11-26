import type { TProtocol } from 'thrift';
import { TCompactProtocol, TFramedTransport } from 'thrift';

export interface ThriftSerde<T> {
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
