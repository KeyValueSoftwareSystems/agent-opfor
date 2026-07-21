FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm install --ignore-scripts

COPY src ./src
COPY public ./public
COPY tsconfig.json ./

EXPOSE 4001

CMD ["npx", "tsx", "src/index.ts"]
