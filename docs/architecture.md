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
   │(packages/  │ │(packages/ │  │(packages/    │
   │  session-  │ │  vector-  │  │  graph-      │
   │  memory)   │ │  store)   │  │  store)      │
   └─────┬──────┘ └────┬──────┘  └───────┬──────┘
         │             │                  │
         │      ┌──────▼──────┐   ┌───────▼──────┐
  .aikb/ │      │   Qdrant    │   │    Neo4j     │
  files  │      │  (Docker)   │   │   (Docker)   │
         │      └─────────────┘   └──────────────┘
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
