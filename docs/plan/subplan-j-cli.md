# ⬜ Subplan J — CLI App

## Overview

Implement the `aikb` CLI application (`apps/cli`) that exposes all knowledge base features through a unified command-line interface. The CLI uses Commander.js for argument parsing, supports `--json` output mode for scripting, shows progress bars during long operations, and is the primary human interface to the system.

---

## Dependencies

- Subplan A (monorepo foundation)
- Subplan B (`@aikb/core-types`)
- Subplan C (`@aikb/core-config`)
- Subplan D (`@aikb/core-fs-scan`)
- Subplan E (`@aikb/core-chunking`)
- Subplan F (`@aikb/core-embeddings`)
- Subplan G (`@aikb/session-memory`)
- Subplan H (`@aikb/vector-store`)
- Subplan I (`@aikb/graph-store`)

---

## Detailed Tasks

### J1 ⬜ App scaffold

- Directory: `apps/cli/`
- Package name: `@aikb/cli`
- `package.json` bin: `{ "aikb": "./dist/bin/aikb.js" }`
- Runtime dependencies:
  - All `@aikb/*` packages above (workspace:*)
  - `commander ^12.0`
  - `cli-progress ^3.12`
  - `chalk ^5.3`
  - `ora ^8.0`
- Build: `tsup bin/aikb.ts --format esm --dts false --clean --banner.js '#!/usr/bin/env node'`

### J2 ⬜ Entry point

```ts
// bin/aikb.ts
import { program } from 'commander';
import { registerSessionCommands } from '../src/commands/session.js';
import { registerVectorCommands } from '../src/commands/vector.js';
import { registerGraphCommands } from '../src/commands/graph.js';
import { registerModelsCommands } from '../src/commands/models.js';
import { registerConfigCommands } from '../src/commands/config.js';
import { version } from '../package.json' assert { type: 'json' };

program
  .name('aikb')
  .description('AI Knowledge Base CLI — session memory, vector search, graph store')
  .version(version)
  .option('--json', 'Output results as JSON (machine-readable)')
  .option('--debug', 'Enable debug logging');

registerSessionCommands(program);
registerVectorCommands(program);
registerGraphCommands(program);
registerModelsCommands(program);
registerConfigCommands(program);

program.parseAsync(process.argv).catch(err => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

### J3 ⬜ Session commands

```
aikb session start [--title <title>] [--tag <tag>...]
aikb session add <session-id> --role <user|assistant|system> <message>
aikb session show <session-id> [--format md|json]
aikb session list [--limit <n>]
aikb session search <pattern> [--limit <n>]
```

```ts
// src/commands/session.ts
export function registerSessionCommands(program: Command): void {
  const session = program.command('session').description('Session memory operations');

  session
    .command('start')
    .description('Create a new session')
    .option('--title <title>', 'Session title')
    .option('--tag <tag...>', 'Session tags')
    .action(async (opts) => {
      const store = await createSessionStore();
      const meta = await store.create({ title: opts.title, tags: opts.tag });
      output(program, meta, `Created session: ${meta.id}`);
    });

  session
    .command('add <session-id> <message>')
    .description('Add a message to a session')
    .requiredOption('--role <role>', 'Message role: user, assistant, system, tool')
    .action(async (sessionId, message, opts) => {
      const store = await createSessionStore();
      const entry = await store.add(sessionId, {
        role: opts.role,
        content: message,
        timestamp: new Date().toISOString(),
      });
      output(program, entry, `Added entry ${entry.id}`);
    });

  // ... show, list, search commands
}
```

### J4 ⬜ Vector commands

```
aikb vector ingest --root <path> [--collection <name>] [--batch-size <n>]
aikb vector query <text> [--top-k <n>] [--collection <name>]
aikb vector status [--collection <name>]
```

`ingest` command flow:
1. Read config (`getConfig()`)
2. Create embedding provider + vector store
3. `ensureCollection(dimensions)`
4. `scanFolder({ root })` → `AsyncIterable<FileEntry>`
5. For each file: `loadAndChunk(entry)` → chunks
6. Batch chunks (default batch size: 50)
7. For each batch: `embedBatch(contents)` → vectors
8. `upsert(chunks, vectors)` → log inserted/skipped
9. Show progress bar (total files, processed, skipped)

```ts
// src/commands/vector.ts
export function registerVectorCommands(program: Command): void {
  const vector = program.command('vector').description('Vector store operations');

  vector
    .command('ingest')
    .description('Scan a directory and ingest files into the vector store')
    .requiredOption('--root <path>', 'Root directory to scan')
    .option('--collection <name>', 'Collection name (overrides config)')
    .option('--batch-size <n>', 'Embedding batch size', '50')
    .action(async (opts) => {
      // Full ingestion pipeline with progress bar
    });

  // ... query, status commands
}
```

### J5 ⬜ Graph commands

```
aikb graph ingest --root <path> [--batch-size <n>]
aikb graph query --cypher <cypher>
aikb graph ask --text <question>
```

`graph ask` uses the LLM to generate a Cypher query from natural language, runs it, and summarizes the results:
```ts
// Pseudocode for 'graph ask'
const cypher = await generateCypher(text, config.llm);
const results = await store.queryCypher(cypher);
const answer = await summarizeResults(text, results, config.llm);
output(program, { cypher, results, answer }, answer);
```

### J6 ⬜ Models commands

```
aikb models list
aikb models download <model-id>
```

`models list` output:
```
┌───────────────────────────────────────────────────────────────┐
│  Model                              Dims   Size    Default     │
├───────────────────────────────────────────────────────────────┤
│  Xenova/all-MiniLM-L6-v2           384    ~23MB   ✓ DEFAULT   │
│  Xenova/bge-small-en-v1.5          384    ~33MB               │
│  nomic-ai/nomic-embed-text-v1.5    768    ~130MB              │
│  Snowflake/snowflake-arctic-embed  768    ~110MB              │
│  Supabase/gte-small                384    ~33MB               │
└───────────────────────────────────────────────────────────────┘
```

`models download` shows a progress bar using `cli-progress`.

### J7 ⬜ Config commands

```
aikb config show [--section <section>]
```

Shows the resolved config (with API keys redacted).

### J8 ⬜ Output helpers

```ts
// src/output.ts
export function output<T>(
  program: Command,
  data: T,
  humanMessage: string,
): void {
  if (program.opts().json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(humanMessage);
  }
}

export function exitError(message: string, code = 1): never {
  console.error(chalk.red(`Error: ${message}`));
  process.exit(code);
}
```

### J9 ⬜ Unit tests

`src/__tests__/commands.test.ts`:

- Use `commander`'s `.parseAsync()` on a test `program` instance
- Test `session start` creates a session (mock `createSessionStore`)
- Test `vector ingest` with a small temp directory (mock embedding + vector store)
- Test `--json` flag changes output format
- Test error exit code on missing required options
- Test `models list` prints the model table

---

## File Structure

```
apps/cli/
├── bin/
│   └── aikb.ts          ← entry point
├── src/
│   ├── commands/
│   │   ├── session.ts
│   │   ├── vector.ts
│   │   ├── graph.ts
│   │   ├── models.ts
│   │   └── config.ts
│   ├── output.ts
│   ├── progress.ts      ← progress bar helpers
│   └── __tests__/
│       └── commands.test.ts
├── package.json
└── tsconfig.json
```

---

## Key APIs / Interfaces

| Export | Kind | Description |
|--------|------|-------------|
| `aikb session start` | CLI command | Create a new session |
| `aikb session add` | CLI command | Add an entry to a session |
| `aikb session show` | CLI command | Display session content |
| `aikb session list` | CLI command | List all sessions |
| `aikb session search` | CLI command | Full-text search |
| `aikb vector ingest` | CLI command | Scan + embed + upsert |
| `aikb vector query` | CLI command | Semantic search |
| `aikb vector status` | CLI command | Collection status |
| `aikb graph ingest` | CLI command | Scan + extract + upsert |
| `aikb graph query` | CLI command | Raw Cypher query |
| `aikb graph ask` | CLI command | NL → Cypher → answer |
| `aikb models list` | CLI command | Show model registry |
| `aikb models download` | CLI command | Pre-download a model |
| `aikb config show` | CLI command | Print resolved config |

---

## Acceptance Criteria

- [ ] `pnpm --filter @aikb/cli build` succeeds and produces a binary with `#!/usr/bin/env node`
- [ ] `node dist/bin/aikb.js --help` prints usage
- [ ] `node dist/bin/aikb.js session start` creates a session and prints the ID
- [ ] `node dist/bin/aikb.js session start --json` prints valid JSON
- [ ] `node dist/bin/aikb.js vector ingest --root .` runs end-to-end (requires Qdrant)
- [ ] `node dist/bin/aikb.js models list` prints the model table
- [ ] All commands support `--help`
- [ ] Exit code is 0 on success, 1 on error

---

## Notes for Implementers

- Use `chalk` for colors in human-readable output, but disable colors when `--json` flag is set or when `!process.stdout.isTTY`.
- Use `ora` for spinners during LLM calls (single-item operations) and `cli-progress` for batch operations.
- Never use `console.log` for errors — always `console.error` so errors don't pollute JSON stdout.
- Commander's `parseAsync` is required because all commands are async.
- Consider adding a `--dry-run` flag to `ingest` commands that shows what would be ingested without writing.
- The binary should be installable globally: `pnpm add -g @aikb/cli` should make `aikb` available in `PATH`.
