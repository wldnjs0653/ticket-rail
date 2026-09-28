FROM node:24.20.0-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src

ENV NODE_ENV=production
ENV PORT=8081

EXPOSE 8081

USER node

CMD ["node", "src/server.js"]

