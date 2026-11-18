# Build from the repo root so npm workspaces (e.g. libs/shared) resolve:
#   docker build -f tasks/trove-backfill/Dockerfile -t trove-backfill .
# Uses Docker Hardened Images (https://docs.docker.com/dhi/), so run `docker login dhi.io` first.

# The -dev variant includes npm and a shell for building.
FROM dhi.io/node:26-alpine3.24-dev AS builder
WORKDIR /app
COPY . .
RUN npm ci --workspace=trove-backfill --ignore-scripts \
	&& npm run build --workspace=trove-backfill

# The bundle is self-contained, so the runtime image only needs node. It has no shell or npm and runs as `node`.
FROM dhi.io/node:26-alpine3.24
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/tasks/trove-backfill/dist/index.cjs ./index.cjs
CMD ["node", "index.cjs"]
