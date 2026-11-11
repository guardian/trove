# Build from the repo root so npm workspaces (e.g. libs/shared) resolve:
#   docker build -f ecs/trove-backfill-ecs/Dockerfile -t trove-backfill-ecs .
FROM node:26-alpine AS builder
WORKDIR /app
COPY . .
RUN npm ci --workspace=trove-backfill-ecs --ignore-scripts \
	&& npm run build --workspace=trove-backfill-ecs

# The bundle is self-contained, so the runtime image only needs node.
FROM node:26-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app/ecs/trove-backfill-ecs/dist/index.cjs ./index.cjs
USER node
CMD ["node", "index.cjs"]
