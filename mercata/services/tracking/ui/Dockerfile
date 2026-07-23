FROM node:22-alpine AS builder

WORKDIR /build

COPY package*.json ./

RUN npm ci

COPY . .

RUN npm run build


FROM node:22-alpine

WORKDIR /app

RUN npm install -g serve@14 && npm cache clean --force

COPY --from=builder /build/dist ./dist

COPY docker-run.sh ./docker-run.sh

RUN chmod +x ./docker-run.sh

EXPOSE 8080

CMD ["/app/docker-run.sh"]
