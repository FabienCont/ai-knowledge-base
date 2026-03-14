# ⬜ AI Knowledge Base — Master Project Plan

## Project Overview

A **monorepo** for an AI-powered knowledge base that integrates three complementary storage and retrieval systems:

| System | Description |
|--------|-------------|
| **Session Memory** | Flat-text per-session memory store with search (markdown + JSONL) |
| **Vector Store** | Semantic search via Qdrant embeddings (cosine similarity) |
| **Graph Store** | Entity/relation extraction stored in Neo4j with LLM-assisted ingestion |

All three systems are exposed through a unified CLI (`aikb`) and an MCP (Model Context Protocol) server, making the knowledge base accessible to AI agents and human operators alike.

---

## Tech Stack

| Concern | Technology |
|---------|-----------|
| Runtime | Node.js 20+ (ESM) |
| Language | TypeScript (strict mode) |
| Package manager | pnpm workspaces |
| Build | `tsup` (packages), `tsx` (dev/run) |
| Test | Vitest with workspace config |
| Lint | ESLint + Prettier |
| Task runner | pnpm scripts (+ optional Turborepo) |
| Schema validation | Zod |
| Vector DB | Qdrant (via `@qdrant/js-client-rest`) |
| Graph DB | Neo4j (via `neo4j-driver`) |
| Embeddings | `@huggingface/transformers` (local-first) + OpenAI + Ollama |
| CLI | Commander.js or Yargs |
| MCP | `@modelcontextprotocol/sdk` |

---

## Monorepo Structure

```
ai-knowledge-base/
├── PLAN.md                         ← this file
├── README.md
├── package.json                    ← root scripts: build, test, lint, typecheck, dev
├── pnpm-workspace.yaml             ← packages/*, apps/*
├── tsconfig.base.json              ← strict, ESM, project references
├── .eslintrc.cjs
├── .prettierrc
├── .nvmrc                          ← "20"
├── .gitignore
│
├── packages/
│   ├── core-types/                 ← Subplan B
│   │   ├── src/index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── core-config/                ← Subplan C
│   │   ├── src/index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── core-fs-scan/               ← Subplan D
│   │   ├── src/index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── core-chunking/              ← Subplan E
│   │   ├── src/index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── core-embeddings/            ← Subplan F
│   │   ├── src/index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── session-memory/             ← Subplan G
│   │   ├── src/index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── vector-store/               ← Subplan H
│   │   ├── src/index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── graph-store/                ← Subplan I
│       ├── src/index.ts
│       ├── package.json
│       └── tsconfig.json
│
├── apps/
│   ├── cli/                        ← Subplan J
│   │   ├── bin/aikb.ts
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   └── mcp-server/                 ← Subplan K
│       ├── src/index.ts
│       ├── src/tools/
│       ├── package.json
│       └── tsconfig.json
│
├── docker/
│   └── docker-compose.yml          ← Subplan L
│
└── docs/
    ├── architecture.md             ← Subplan L
    ├── CONVENTIONS.md              ← Subplan L
    └── plan/
        ├── subplan-a-monorepo-foundation.md
        ├── subplan-b-core-types.md
        ├── subplan-c-core-config.md
        ├── subplan-d-core-fs-scan.md
        ├── subplan-e-core-chunking.md
        ├── subplan-f-core-embeddings.md
        ├── subplan-g-session-memory.md
        ├── subplan-h-vector-store.md
        ├── subplan-i-graph-store.md
        ├── subplan-j-cli.md
        ├── subplan-k-mcp-server.md
        └── subplan-l-docker-integration-docs.md
```

---

## Embedding Model Strategy

All embedding operations are **local-first**: the default provider auto-downloads models via `@huggingface/transformers` with no API key required. Remote providers (OpenAI, Ollama) are opt-in via config.

### Model Registry

| Model | Dimensions | Size | Use Case | Default? |
|-------|-----------|------|----------|----------|
| `Xenova/all-MiniLM-L6-v2` | 384 | ~23 MB | Fastest, zero-config | ✅ **DEFAULT** |
| `Xenova/bge-small-en-v1.5` | 384 | ~33 MB | Better retrieval quality | |
| `nomic-ai/nomic-embed-text-v1.5` | 768 | ~130 MB | High quality | |
| `Snowflake/snowflake-arctic-embed-m` | 768 | ~110 MB | High quality alternative | |
| `Supabase/gte-small` | 384 | ~33 MB | Balanced | |

Models are stored in `~/.cache/huggingface/hub/` (HF default). Progress bars show download status on first use.

---

## Subplan Table

| Status | ID | Name | Description | File | Completed |
|--------|----|------|-------------|------|-----------|
| ✅ | A | Monorepo Foundation | pnpm workspace, tsconfig, build, lint, vitest | [subplan-a-monorepo-foundation.md](docs/plan/subplan-a-monorepo-foundation.md) | — |
| ✅ | B | Core Types | Shared types + Zod schemas used across all packages | [subplan-b-core-types.md](docs/plan/subplan-b-core-types.md) | — |
| ✅ | C | Core Config | Unified config loading (CLI flags → env → file) | [subplan-c-core-config.md](docs/plan/subplan-c-core-config.md) | — |
| ✅ | D | Core FS Scan | Recursive folder scanner with ignore rules | [subplan-d-core-fs-scan.md](docs/plan/subplan-d-core-fs-scan.md) | 2026-03-12 |
| ✅ | E | Core Chunking | Text splitting with metadata and hashing | [subplan-e-core-chunking.md](docs/plan/subplan-e-core-chunking.md) | 2026-03-12 |
| ✅ | F | Core Embeddings | Provider-agnostic embedding (local HF default) | [subplan-f-core-embeddings.md](docs/plan/subplan-f-core-embeddings.md) | 2026-03-12 |
| ✅ | G | Session Memory | Flat-text per-session memory store | [subplan-g-session-memory.md](docs/plan/subplan-g-session-memory.md) | 2026-03-13 |
| ✅ | H | Vector Store | Qdrant adapter for vector upsert/query | [subplan-h-vector-store.md](docs/plan/subplan-h-vector-store.md) | 2026-03-13 |
| ✅ | I | Graph Store | Neo4j adapter + LLM entity/relation extraction | [subplan-i-graph-store.md](docs/plan/subplan-i-graph-store.md) | 2026-03-14 |
| ⬜ | J | CLI App | `aikb` CLI with all subcommands | [subplan-j-cli.md](docs/plan/subplan-j-cli.md) | |
| ⬜ | K | MCP Server | MCP server exposing all tools | [subplan-k-mcp-server.md](docs/plan/subplan-k-mcp-server.md) | |
| ⬜ | L | Docker + Docs | docker-compose, getting started, architecture docs | [subplan-l-docker-integration-docs.md](docs/plan/subplan-l-docker-integration-docs.md) | |

---

## Execution Order / Dependency Graph

```
A (monorepo foundation)
└── B (core-types)
    ├── C (core-config) ← depends on B
    ├── D (core-fs-scan) ← depends on B
    ├── E (core-chunking) ← depends on B, D
    ├── F (core-embeddings) ← depends on B, C
    ├── G (session-memory) ← depends on B, C
    ├── H (vector-store) ← depends on B, C, F
    └── I (graph-store + llm-extract) ← depends on B, C, E, F
        ├── J (CLI) ← depends on all packages
        ├── K (MCP server) ← depends on all packages
        └── L (docker + docs) ← depends on H, I
```

### Recommended Build Order

| Wave | Subplans | Parallelizable? |
|------|----------|----------------|
| 1 | A | — |
| 2 | B | — |
| 3 | C, D | ✅ parallel |
| 4 | E, F | ✅ parallel (E needs D) |
| 5 | G | after B+C |
| 6 | H | after F |
| 7 | I | after E+F |
| 8 | J, K | ✅ parallel (after all packages) |
| 9 | L | after J+K |

---

## Status Legend

| Icon | Meaning |
|------|---------|
| ⬜ | Not started (initial state for all subplans) |
| 🔧 | In progress |
| ✅ | Completed |
