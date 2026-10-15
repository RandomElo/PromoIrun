# Debian plutôt qu'Alpine : resvg fournit des binaires ARM 32 et 64 bits pour glibc (Raspberry Pi)
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production NPM_CONFIG_UPDATE_NOTIFIER=false

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Node exécute directement le TypeScript
COPY src ./src
COPY assets ./assets

RUN mkdir -p data && chown node:node data
USER node

CMD ["node", "src/index.ts"]
