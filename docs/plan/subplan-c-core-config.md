# ⬜ Subplan C — Core Config

## Overview

Implement a unified configuration loader (`@aikb/core-config`) that merges settings from multiple sources in priority order: **CLI flags → environment variables → `.env` file → config file → defaults**. All configuration is validated with Zod and typed. A singleton `getConfig()` ensures the config is loaded once per process.

---

## Dependencies

- Subplan A (monorepo foundation)
- Subplan B (core-types, for any type cross-references)

---

## Detailed Tasks

### C1 ⬜ Package scaffold

- Create `packages/core-config/` using the Subplan A template
- Package name: `@aikb/core-config`
- Runtime dependencies:
  - `zod ^3.22`
  - `dotenv ^16.4`
  - `@aikb/core-types workspace:*`

### C2 ⬜ Config schema definition

Define the full Zod schema in `src/schema.ts`:

```ts
import { z } from 'zod';

export const EmbeddingConfigSchema = z.object({
  provider: z.enum(['local', 'openai', 'ollama']).default('local'),
  model: z.string().default('Xenova/all-MiniLM-L6-v2'),
  dimensions: z.number().int().positive().optional(),
  // OpenAI
  openai_api_key: z.string().optional(),
  openai_base_url: z.string().url().optional(),
  // Ollama
  ollama_base_url: z.string().url().default('http://localhost:11434'),
  // Cache
  cache_enabled: z.boolean().default(false),
  cache_dir: z.string().optional(),
});

export const VectorConfigSchema = z.object({
  provider: z.enum(['qdrant']).default('qdrant'),
  qdrant_url: z.string().url().default('http://localhost:6333'),
  qdrant_api_key: z.string().optional(),
  collection_name: z.string().default('aikb'),
  distance: z.enum(['cosine', 'dot', 'euclid']).default('cosine'),
});

export const GraphConfigSchema = z.object({
  provider: z.enum(['neo4j']).default('neo4j'),
  neo4j_uri: z.string().default('bolt://localhost:7687'),
  neo4j_user: z.string().default('neo4j'),
  neo4j_password: z.string().default('password'),
  neo4j_database: z.string().default('neo4j'),
});

export const LLMConfigSchema = z.object({
  provider: z.enum(['openai', 'ollama', 'none']).default('none'),
  model: z.string().default('gpt-4o-mini'),
  api_key: z.string().optional(),
  base_url: z.string().url().optional(),
  temperature: z.number().min(0).max(2).default(0.0),
  max_tokens: z.number().int().positive().default(2048),
});

export const SessionConfigSchema = z.object({
  data_dir: z.string().default('.aikb/sessions'),
});

export const ScanConfigSchema = z.object({
  default_include: z.array(z.string()).default(['**/*']),
  default_exclude: z.array(z.string()).default([
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/.turbo/**',
    '**/coverage/**',
  ]),
  max_file_size_bytes: z.number().int().positive().default(5 * 1024 * 1024), // 5MB
  max_depth: z.number().int().positive().default(20),
  follow_symlinks: z.boolean().default(false),
});

export const AppConfigSchema = z.object({
  embedding: EmbeddingConfigSchema.default({}),
  vector: VectorConfigSchema.default({}),
  graph: GraphConfigSchema.default({}),
  llm: LLMConfigSchema.default({}),
  session: SessionConfigSchema.default({}),
  scan: ScanConfigSchema.default({}),
  log_level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  data_dir: z.string().default('.aikb'),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type EmbeddingConfig = z.infer<typeof EmbeddingConfigSchema>;
export type VectorConfig = z.infer<typeof VectorConfigSchema>;
export type GraphConfig = z.infer<typeof GraphConfigSchema>;
export type LLMConfig = z.infer<typeof LLMConfigSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type ScanConfig = z.infer<typeof ScanConfigSchema>;
```

### C3 ⬜ Environment variable mapping

Define `src/env.ts` — maps env vars to config keys:

| Env Var | Config Path |
|---------|------------|
| `AIKB_EMBEDDING_PROVIDER` | `embedding.provider` |
| `AIKB_EMBEDDING_MODEL` | `embedding.model` |
| `OPENAI_API_KEY` | `embedding.openai_api_key` + `llm.api_key` |
| `AIKB_QDRANT_URL` | `vector.qdrant_url` |
| `AIKB_QDRANT_API_KEY` | `vector.qdrant_api_key` |
| `AIKB_NEO4J_URI` | `graph.neo4j_uri` |
| `AIKB_NEO4J_USER` | `graph.neo4j_user` |
| `AIKB_NEO4J_PASSWORD` | `graph.neo4j_password` |
| `AIKB_LLM_PROVIDER` | `llm.provider` |
| `AIKB_LLM_MODEL` | `llm.model` |
| `AIKB_LOG_LEVEL` | `log_level` |
| `AIKB_DATA_DIR` | `data_dir` |

Implementation:
```ts
export function loadFromEnv(): Partial<Record<string, unknown>> {
  // Returns a deep partial config object populated from process.env
}
```

### C4 ⬜ Config file loading

Support `aikb.config.json` (or `aikb.config.js`) at the project root or a path specified by `AIKB_CONFIG_FILE`:

```ts
// src/file.ts
export async function loadFromFile(configPath?: string): Promise<Partial<AppConfig>>;
```

- Search order: explicit path → `./aikb.config.json` → `./aikb.config.js` → none
- Parse JSON directly; for JS files use dynamic `import()`
- On parse error, throw a descriptive `ConfigError`

### C5 ⬜ Config merger & singleton

```ts
// src/config.ts
let _config: AppConfig | null = null;

export async function getConfig(overrides?: Partial<AppConfig>): Promise<AppConfig> {
  if (_config) return _config;
  // 1. Load .env file (dotenv)
  // 2. Load config file
  // 3. Load env vars
  // 4. Deep-merge: defaults ← file ← env ← overrides
  // 5. Parse with AppConfigSchema (throws on invalid)
  // 6. Cache & return
  _config = AppConfigSchema.parse(merged);
  return _config;
}

export function resetConfig(): void {
  // For testing only — clears the singleton
  _config = null;
}
```

Deep merge strategy:
- Objects are merged recursively
- Arrays are replaced (not appended)
- `undefined` values are skipped

### C6 ⬜ Error handling

```ts
// src/errors.ts
export class ConfigError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'ConfigError';
  }
}
```

Wrap Zod validation errors: provide human-readable messages listing each invalid field.

### C7 ⬜ Unit tests

`src/__tests__/config.test.ts`:

- Test defaults load correctly when no env/file present
- Test env var overrides (set `process.env.AIKB_EMBEDDING_PROVIDER = 'openai'`)
- Test config file loading from a temp JSON file
- Test CLI override merging
- Test invalid config throws `ConfigError` with a clear message
- Test `resetConfig()` clears the singleton
- Mock `dotenv` for isolated tests

---

## File Structure

```
packages/core-config/
├── src/
│   ├── index.ts          ← exports getConfig, resetConfig, AppConfig, ...
│   ├── schema.ts         ← Zod schemas
│   ├── env.ts            ← env var → config mapping
│   ├── file.ts           ← file loading
│   ├── config.ts         ← singleton getConfig()
│   ├── errors.ts         ← ConfigError
│   └── __tests__/
│       └── config.test.ts
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

---

## Key APIs / Interfaces

| Export | Kind | Description |
|--------|------|-------------|
| `getConfig(overrides?)` | `async function` | Returns validated AppConfig singleton |
| `resetConfig()` | `function` | Clears singleton (for tests) |
| `AppConfig` | type | Full config type |
| `EmbeddingConfig` | type | Embedding subsection |
| `VectorConfig` | type | Vector store subsection |
| `GraphConfig` | type | Graph store subsection |
| `LLMConfig` | type | LLM subsection |
| `SessionConfig` | type | Session memory subsection |
| `ScanConfig` | type | FS scan subsection |
| `AppConfigSchema` | Zod schema | Root schema |
| `ConfigError` | class | Config loading/validation error |

---

## Acceptance Criteria

- [ ] `pnpm --filter @aikb/core-config build` succeeds
- [ ] `pnpm --filter @aikb/core-config test` passes — all source paths tested
- [ ] `getConfig()` returns defaults when no env or file is present
- [ ] Setting `AIKB_EMBEDDING_PROVIDER=openai` results in `config.embedding.provider === 'openai'`
- [ ] A `aikb.config.json` file overrides defaults correctly
- [ ] Invalid config (e.g., unknown provider) throws `ConfigError` with a field-level message
- [ ] `resetConfig()` allows tests to use fresh configs

---

## Notes for Implementers

- Always call `dotenv.config()` **before** reading `process.env` — some CI environments may have `.env` files.
- The singleton pattern is safe for CLI/MCP use (single process). For tests, always call `resetConfig()` in `beforeEach`.
- Do not expose any sensitive config values (API keys) in log output — use `[REDACTED]` when logging the config object.
- Prefer `AppConfigSchema.parse()` over `safeParse()` in the config loader so errors bubble up loudly.
- Document each env var in the generated `docs/CONVENTIONS.md` (see Subplan L).
