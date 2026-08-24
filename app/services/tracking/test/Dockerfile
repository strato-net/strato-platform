# Test runner + mock servers for the tracking service integration suite.
# Both the `mocks` and `tests` services in ../docker-compose.test.yml build
# this image; they differ only in the command.
FROM node:22-alpine

WORKDIR /tests

COPY package*.json ./

RUN npm ci

COPY tsconfig.json ./

COPY src/ ./src/

RUN npm run build

CMD ["npm", "test"]
