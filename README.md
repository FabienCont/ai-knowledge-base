# AI Knowledge Base

A monorepo for an AI-powered knowledge base that integrates session memory, vector search, and graph-based entity/relation storage — all accessible via a CLI and an MCP server.

## Quick Start

### 1. Start infrastructure

```bash
docker compose -f docker/docker-compose.yml up -d
```

### 2. Install dependencies and build

```bash
pnpm install
pnpm -r build
```

### 3. Ingest and query

```bash
# Ingest documents into the vector store
node apps/cli/dist/bin/aikb.js vector ingest --root ./docs

# Semantic search
node apps/cli/dist/bin/aikb.js vector query "how does the embedding system work"
```

## Documentation

- [Getting Started](docs/getting-started.md) — full setup guide, configuration, and MCP usage
- [Architecture](docs/architecture.md) — system overview and data flow diagrams
- [Conventions](docs/CONVENTIONS.md) — coding standards, naming, and environment variables
- [Project Plan](PLAN.md) — subplan breakdown and implementation status