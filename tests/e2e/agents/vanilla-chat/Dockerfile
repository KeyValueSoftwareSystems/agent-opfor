FROM node:22-alpine

WORKDIR /app

# Copy workspace root manifests for npm workspaces install
COPY package.json package-lock.json ./
COPY tests/e2e/agents/vanilla-chat/package.json ./tests/e2e/agents/vanilla-chat/

# Install only this workspace package's deps (devDependencies included — needed at runtime via tsx)
RUN npm install --workspace=@agent-opfor/test-agent-vanilla-chat --ignore-scripts

# Copy agent source
COPY tests/e2e/agents/vanilla-chat/src ./tests/e2e/agents/vanilla-chat/src
COPY tests/e2e/agents/vanilla-chat/tsconfig.json ./tests/e2e/agents/vanilla-chat/

WORKDIR /app/tests/e2e/agents/vanilla-chat

EXPOSE 4000

CMD ["npx", "tsx", "src/index.ts"]
