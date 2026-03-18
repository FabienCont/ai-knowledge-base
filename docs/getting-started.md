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
