FROM node:24.20.0-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node src ./src

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

USER node

CMD ["node", "src/server.js"]

