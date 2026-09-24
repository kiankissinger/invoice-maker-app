# Build context is the repository root (the server bundles shared code from src/lib).
#   docker build -f server/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package.json server/package-lock.json server/
RUN cd server && npm ci
COPY src/lib src/lib
COPY server server
RUN cd server && npm run build && npm prune --omit=dev

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY --from=build /app/server/package.json ./
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
