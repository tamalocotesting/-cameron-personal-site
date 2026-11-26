# The Rail — production image. Business data is mounted at runtime, never baked in.
FROM node:22.18-slim
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY . .
RUN rm -rf private data && npm run build && npm prune --omit=dev
VOLUME ["/app/data"]
EXPOSE 8787
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.ts"]
