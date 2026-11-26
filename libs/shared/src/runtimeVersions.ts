// Logs the exact runtime versions (including bundled components such as
// OpenSSL) as a single JSON line, so that we can find what is actually running
// in prod when responding to vulnerabilities.
//
// Written straight to stdout rather than via console.log, because Lambda's JSON
// log format (the GuCDK default) would otherwise nest it under `message`, which
// Central ELK fails to ingest (see guardian/aws-lambda-log-format and
// guardian/cloudwatch-logs-management#326). Lambda passes a raw JSON line
// through as-is in both JSON and text formats, so its fields are top-level in
// CloudWatch Logs Insights and Central ELK. Powertools' Logger does the same.
export function logRuntimeVersions(): void {
	const { node, openssl } = process.versions;
	const record = {
		timestamp: new Date().toISOString(),
		level: 'INFO',
		message: `Runtime versions: node ${node}, openssl ${openssl}, arch ${process.arch}`,
		// Only the most security-relevant versions get their own fields, to avoid
		// a field per bundled component in ELK. Node's other bundled versions are
		// fixed per release (see https://nodejs.org/dist/index.json), and kept as
		// a single searchable string just in case.
		runtimeVersions: { node, openssl },
		runtimeVersionsDetail: JSON.stringify(process.versions),
		awsExecutionEnv: process.env.AWS_EXECUTION_ENV,
		platform: process.platform,
		arch: process.arch,
	};
	process.stdout.write(`${JSON.stringify(record)}\n`);
}
