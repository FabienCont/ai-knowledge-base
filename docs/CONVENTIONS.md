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

- Each package defines its own error class extending `Error` (e.g. `ConfigError`, `VectorStoreError`)
- Zod validation errors are wrapped with field-level messages
- Never swallow errors silently — log and rethrow
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
| `AIKB_MCP_TRANSPORT` | `stdio` | `stdio` only (`sse` is not yet implemented) |
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
