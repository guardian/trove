#!/usr/bin/env bash
# Reports the exact versions of the toolchain actually on PATH, alongside
# what .tool-versions declares, so that loose declarations (e.g. `nodejs 26`)
# can be resolved to what is really running.
# Run locally, or in CI where it also writes a table to the job summary.

set -euo pipefail

cd "$(dirname "$0")/.."

declared() {
	awk -v tool="$1" '$1 == tool { print $2 }' .tool-versions
}

actual() {
	"$@" 2>/dev/null || echo "not installed"
}

aws_cli_version() {
	# e.g. "aws-cli/2.33.20 Python/3.13.7 Linux/6.8.0 exe/x86_64"
	aws --version 2>/dev/null | awk '{ split($1, a, "/"); print a[2] }'
}

rows=(
	"node|$(declared nodejs)|$(actual node -p 'process.versions.node')"
	"openssl (bundled in node)||$(actual node -p 'process.versions.openssl')"
	"npm|$(declared npm)|$(actual npm --version)"
	"aws-cli|$(declared aqua:aws/aws-cli)|$(actual aws_cli_version)"
)

json="{"
for row in "${rows[@]}"; do
	IFS='|' read -r tool _ actual_version <<<"$row"
	json+="\"${tool%% *}\":\"${actual_version}\","
done

# Set on GitHub-hosted runners; identifies the runner image that supplied the toolcache
if [[ -n "${ImageOS:-}" ]]; then
	rows+=("runner image||${ImageOS} ${ImageVersion:-}")
	json+="\"runnerImage\":\"${ImageOS} ${ImageVersion:-}\","
fi

json="${json%,}}"

# Pad columns to equal widths so the table is readable in a terminal too
rows=("Tool|Declared|Actual" "${rows[@]}")
widths=(0 0 0)
for row in "${rows[@]}"; do
	IFS='|' read -r -a cells <<<"$row"
	for i in 0 1 2; do
		cell=${cells[i]:--}
		if ((${#cell} > widths[i])); then widths[i]=${#cell}; fi
	done
done

format_row() {
	printf "| %-*s | %-*s | %-*s |\n" "${widths[0]}" "$1" "${widths[1]}" "$2" "${widths[2]}" "$3"
}

dashes() {
	printf '%*s' "$1" '' | tr ' ' -
}

table=""
for index in "${!rows[@]}"; do
	IFS='|' read -r tool declared_version actual_version <<<"${rows[index]}"
	table+=$(format_row "$tool" "${declared_version:--}" "$actual_version")$'\n'
	if ((index == 0)); then
		table+=$(format_row "$(dashes "${widths[0]}")" "$(dashes "${widths[1]}")" "$(dashes "${widths[2]}")")$'\n'
	fi
done
table=${table%$'\n'}

echo "$table"
# Single structured line, so versions can be grepped from CI logs
echo "runtime_versions ${json}"

if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
	{
		echo "### Runtime versions"
		echo
		echo "$table"
	} >>"$GITHUB_STEP_SUMMARY"
fi
