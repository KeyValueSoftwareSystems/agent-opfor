FROM node:22-alpine

WORKDIR /app

# Copy workspace root manifests for npm workspaces install
COPY package.json package-lock.json ./
COPY tests/e2e/agents/customer-support/package.json ./tests/e2e/agents/customer-support/

# Install only this workspace package's deps (devDependencies included — needed at runtime via tsx)
RUN npm install --workspace=@astra/test-agent-customer-support --ignore-scripts

# Copy agent source
COPY tests/e2e/agents/customer-support/src ./tests/e2e/agents/customer-support/src
COPY tests/e2e/agents/customer-support/tsconfig.json ./tests/e2e/agents/customer-support/

WORKDIR /app/tests/e2e/agents/customer-support

EXPOSE 4001

CMD ["npx", "tsx", "src/index.ts"]
