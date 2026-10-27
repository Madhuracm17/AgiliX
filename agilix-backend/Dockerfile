# AgiliX backend (NestJS) — also contains the MCP server (node dist/mcp/mcp-main.js).
# Build:  docker build -t agilix-backend ./agilix-backend
# Run:    docker run --env-file agilix-backend/.env -p 3000:3000 agilix-backend

FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY tsconfig.json nest-cli.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s \
  CMD wget -qO- "http://127.0.0.1:${PORT:-3000}/" >/dev/null 2>&1 || [ $? -eq 8 ]
CMD ["node", "dist/main"]
