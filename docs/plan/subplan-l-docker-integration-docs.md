# ✅ Subplan L — Docker + Integration + Docs

## Overview

Wire everything together with a single `docker compose up -d` that starts all infrastructure (Qdrant + Neo4j), provide comprehensive getting-started documentation, an architecture diagram, and a conventions reference. After completing this subplan, the full system is runnable with one command.

---

## Dependencies

- Subplan A (monorepo foundation — project structure)
- Subplan H (`@aikb/vector-store` — Qdrant)
- Subplan I (`@aikb/graph-store` — Neo4j)
- Subplan J (`@aikb/cli` — `aikb` binary)
- Subplan K (`@aikb/mcp-server` — MCP server)

---

## Detailed Tasks

### L1 ✅ Docker Compose file

Create `docker/docker-compose.yml` (or update if created by Subplans H/I):

```yaml
version: '3.8'

services:
  qdrant:
    image: qdrant/qdrant:latest
    container_name: aikb-qdrant
    ports:
      - "6333:6333"   # REST API
      - "6334:6334"   # gRPC
    volumes:
      - qdrant_data:/qdrant/storage
    environment:
      QDRANT__SERVICE__API_KEY: ""
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:6333/healthz"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped

  neo4j:
    image: neo4j:5-community
    container_name: aikb-neo4j
    ports:
      - "7474:7474"   # HTTP (Neo4j Browser)
      - "7687:7687"   # Bolt
    volumes:
      - neo4j_data:/data
      - neo4j_logs:/logs
    environment:
      NEO4J_AUTH: neo4j/password
      NEO4J_PLUGINS: '["apoc"]'
      NEO4J_dbms_memory_pagecache_size: 512M
      NEO4J_dbms_memory_heap_max__size: 512M
    healthcheck:
      test: ["CMD", "cypher-shell", "-u", "neo4j", "-p", "password", "RETURN 1"]
      interval: 15s
      timeout: 10s
      retries: 10
      start_period: 30s
    restart: unless-stopped

volumes:
  qdrant_data:
    driver: local
  neo4j_data:
    driver: local
  neo4j_logs:
    driver: local
```

Also create `docker/.env.example`:
```
# Copy this to docker/.env and customize
QDRANT_API_KEY=
NEO4J_AUTH=neo4j/password
```

### L2 ✅ Getting started documentation

Create `docs/getting-started.md`:

```markdown
# Getting Started with AI Knowledge Base

## Prerequisites

- Node.js 20+
- pnpm 8+
- Docker & Docker Compose

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/ai-knowledge-base.git
cd ai-knowledge-base
pnpm install
```

### 2. Start infrastructure

```bash
docker compose -f docker/docker-compose.yml up -d
```

Wait ~30 seconds for Neo4j to initialize. Check health:

```bash
docker compose -f docker/docker-compose.yml ps
```

### 3. Build all packages

```bash
pnpm -r build
```

### 4. Ingest your first directory

```bash
# Ingest into the vector store
node apps/cli/dist/bin/aikb.js vector ingest --root ./docs

# Check status
node apps/cli/dist/bin/aikb.js vector status
```

### 5. Query semantically

```bash
node apps/cli/dist/bin/aikb.js vector query "how does the embedding system work"
```

### 6. Start a memory session

```bash
SESSION=$(node apps/cli/dist/bin/aikb.js session start --title "My first session" --json | jq -r '.id')
node apps/cli/dist/bin/aikb.js session add "$SESSION" --role user "What is the project about?"
node apps/cli/dist/bin/aikb.js session show "$SESSION"
```

### 7. Run the MCP server

```bash
node apps/mcp-server/dist/index.js
```

## Configuration

Create `aikb.config.json` in your project root:

```json
{
  "embedding": {
    "provider": "local",
    "model": "Xenova/all-MiniLM-L6-v2"
  },
  "vector": {
    "qdrant_url": "http://localhost:6333",
    "collection_name": "my-project"
  },
  "graph": {
    "neo4j_uri": "bolt://localhost:7687",
    "neo4j_user": "neo4j",
    "neo4j_password": "password"
  }
}
```

See `docs/CONVENTIONS.md` for all configuration options.

## Using with Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "aikb": {
      "command": "node",
      "args": ["/absolute/path/to/apps/mcp-server/dist/index.js"],
      "env": {
        "AIKB_DATA_DIR": "/absolute/path/to/.aikb"
      }
    }
  }
}
```
```

### L3 ✅ Architecture diagram

Create `docs/architecture.md`:

```markdown
# Architecture

## Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                           User / AI Agent                           │
└──────────────────────────┬──────────────────────────────────────────┘
                           │
          ┌────────────────┴────────────────┐
          │                                 │
    ┌─────▼──────┐                   ┌──────▼──────┐
    │  aikb CLI  │                   │ MCP Server  │
    │  (apps/cli)│                   │(apps/mcp-   │
    └─────┬──────┘                   │  server)    │
          │                          └──────┬──────┘
          └────────────┬────────────────────┘
                       │
         ┌─────────────┼──────────────────┐
         │             │                  │
   ┌─────▼──────┐ ┌────▼──────┐  ┌───────▼──────┐
   │  Session   │ │  Vector   │  │    Graph     │
   │  Memory    │ │  Store    │  │    Store     │
   │  (pkg/     │ │  (pkg/    │  │  (pkg/       │
   │  session-  │ │  vector-  │  │  graph-      │
   │  memory)   │ │  store)   │  │  store)      │
   └─────┬──────┘ └────┬──────┘  └───────┬──────┘
         │             │                  │
         │      ┌──────▼──────┐   ┌───────▼──────┐
  .aikb/ │      │   Qdrant    │   │    Neo4j     │
  files  │      │  (Docker)   │   │   (Docker)   │
         │      └─────────────┘   └─────────────-┘
         │
    ┌────▼────────────────────────────────┐
    │           Shared Packages           │
    │  core-types | core-config |         │
    │  core-fs-scan | core-chunking |     │
    │  core-embeddings                    │
    └─────────────────────────────────────┘
```

## Data Flow: Vector Ingestion

```
Directory
    │
    ▼
scanFolder() ─── FileEntry stream
    │
    ▼
loadAndChunk() ─── Chunk[]
    │                  │
    ▼                  ▼
sha256 hash      metadata attachment
    │
    ▼
embedBatch() ─── float32[] vectors
    │
    ▼
QdrantVectorStore.upsert() ─── skip by hash
    │
    ▼
Qdrant DB ✓
```

## Data Flow: Graph Ingestion

```
Directory
    │
    ▼
scanFolder() + loadAndChunk()
    │
    ▼
OpenAIExtractor.extractFromChunk()
    │
    ▼
Entity/Relation extraction (LLM)
    │
    ▼
resolveEntities() (embedding similarity dedup)
    │
    ▼
Neo4jGraphStore.upsertEntities/upsertRelations()
    │
    ▼
Neo4j DB ✓
```
```

### L4 ✅ Conventions reference

Create `docs/CONVENTIONS.md`:

```markdown
# Conventions

## Code Style

- TypeScript strict mode everywhere
- ESM (`"type": "module"`)
- Single quotes, trailing commas, 100 char line width (Prettier)
- `async/await` over raw Promises
- Named exports only (no default exports)
- Index barrel exports per package

## Naming

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | `kebab-case.ts` | `session-store.ts` |
| Classes | `PascalCase` | `FileSessionStore` |
| Interfaces | `PascalCase` | `SessionStore` |
| Functions | `camelCase` | `createSessionStore` |
| Constants | `SCREAMING_SNAKE` | `DEFAULT_MODEL` |
| Package names | `@aikb/kebab-case` | `@aikb/core-types` |

## Error Handling

- All package-level errors extend a base `AikbError`
- Zod validation errors are wrapped with field-level messages
- Never swallow errors silently — log and rethrow or return `Result<T, E>`
- Integration tests that require external services: tag with `@integration`

## Configuration

All environment variables:

| Variable | Default | Description |
|---------|---------|-------------|
| `AIKB_EMBEDDING_PROVIDER` | `local` | `local` \| `openai` \| `ollama` |
| `AIKB_EMBEDDING_MODEL` | `Xenova/all-MiniLM-L6-v2` | Model ID |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `AIKB_QDRANT_URL` | `http://localhost:6333` | Qdrant URL |
| `AIKB_QDRANT_API_KEY` | — | Qdrant API key |
| `AIKB_NEO4J_URI` | `bolt://localhost:7687` | Neo4j URI |
| `AIKB_NEO4J_USER` | `neo4j` | Neo4j user |
| `AIKB_NEO4J_PASSWORD` | `password` | Neo4j password |
| `AIKB_LLM_PROVIDER` | `none` | `none` \| `openai` \| `ollama` |
| `AIKB_LLM_MODEL` | `gpt-4o-mini` | LLM model |
| `AIKB_DATA_DIR` | `.aikb` | Root data directory |
| `AIKB_LOG_LEVEL` | `info` | `debug` \| `info` \| `warn` \| `error` |
| `AIKB_MCP_TRANSPORT` | `stdio` | `stdio` \| `sse` |
| `AIKB_MCP_PORT` | `3001` | Port for SSE transport |

## Testing

- Unit tests: no external dependencies, fast (<100ms per test)
- Integration tests: tagged `@integration`, require env vars to enable
- Snapshot tests: deterministic, committed to git, updated intentionally
- Coverage target: 80% for unit-testable code
- Run integration tests: `QDRANT_URL=... NEO4J_URI=... pnpm test`

## Git

- Branch names: `feat/<name>`, `fix/<name>`, `docs/<name>`, `chore/<name>`
- Commit message: `<type>(<scope>): <description>` (Conventional Commits)
- No direct pushes to `main`
```

### L5 ✅ End-to-end smoke test script

Create `scripts/smoke-test.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== AI Knowledge Base Smoke Test ==="

# 1. Infrastructure check
echo "[1/5] Checking infrastructure..."
curl -sf http://localhost:6333/healthz > /dev/null && echo "  ✓ Qdrant"
curl -sf http://localhost:7474 > /dev/null && echo "  ✓ Neo4j"

# 2. Build
echo "[2/5] Building..."
pnpm -r build

# 3. Vector ingest
echo "[3/5] Vector ingest..."
node apps/cli/dist/bin/aikb.js vector ingest --root docs --json

# 4. Vector query
echo "[4/5] Vector query..."
node apps/cli/dist/bin/aikb.js vector query "getting started" --top-k 3 --json

# 5. Session
echo "[5/5] Session test..."
SESSION=$(node apps/cli/dist/bin/aikb.js session start --json | jq -r '.id')
node apps/cli/dist/bin/aikb.js session add "$SESSION" --role user "Test message"
node apps/cli/dist/bin/aikb.js session show "$SESSION" --json

echo ""
echo "=== Smoke test passed! ==="
```

### L6 ✅ README update

Update the root `README.md` to include:
- Project description
- Quick start (docker compose up + pnpm install + pnpm -r build)
- Link to `docs/getting-started.md`
- Link to `docs/architecture.md`
- Link to `PLAN.md`

---

## File Structure

```
docker/
├── docker-compose.yml
└── .env.example

docs/
├── getting-started.md
├── architecture.md
├── CONVENTIONS.md
└── plan/
    └── ... (existing subplan files)

scripts/
└── smoke-test.sh

README.md  (updated)
```

---

## Key Artifacts

| File | Description |
|------|-------------|
| `docker/docker-compose.yml` | Infrastructure stack (Qdrant + Neo4j) |
| `docs/getting-started.md` | Step-by-step setup guide |
| `docs/architecture.md` | Architecture overview and data flow diagrams |
| `docs/CONVENTIONS.md` | Coding standards, naming, env vars reference |
| `scripts/smoke-test.sh` | End-to-end smoke test |

---

## Acceptance Criteria

- [x] `docker compose -f docker/docker-compose.yml up -d` starts both services
- [x] Both services report healthy via their health checks
- [x] `pnpm -r build` completes successfully after infrastructure is up
- [x] `aikb vector ingest --root .` completes without errors
- [x] `aikb vector query "..."` returns results
- [x] `scripts/smoke-test.sh` passes end-to-end
- [x] `docs/getting-started.md` accurately describes the setup process
- [x] `docs/CONVENTIONS.md` lists all environment variables with defaults

---

## Notes for Implementers

- The Neo4j health check uses `cypher-shell`, which is bundled in the Neo4j Docker image. It takes ~30s on first startup while Neo4j initializes.
- APOC plugin installation requires the `NEO4J_PLUGINS` env var — verify this works with the chosen Neo4j version.
- The smoke test script requires `jq` for JSON parsing. Document this prerequisite.
- Consider adding a `docker/docker-compose.override.yml` for development overrides (e.g., exposing additional ports).
- The getting-started doc should be kept in sync with actual commands as the CLI evolves — add it to the CI smoke test.
- For production deployments: document how to set `NEO4J_AUTH`, `QDRANT__SERVICE__API_KEY`, and `OPENAI_API_KEY` securely (via `.env` or secrets manager).
