# Same image runs locally, on Render and on Railway.
FROM node:22.22.0-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY public ./public

# Run as the unprivileged user shipped with the image; /app/data is only used for a local SQLite file.
RUN mkdir -p /app/data && chown node:node /app/data
USER node

EXPOSE 3000
CMD ["node", "src/main.js"]
