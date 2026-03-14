import { program } from 'commander';
import { createRequire } from 'node:module';
import { registerSessionCommands } from '../src/commands/session.js';
import { registerVectorCommands } from '../src/commands/vector.js';
import { registerGraphCommands } from '../src/commands/graph.js';
import { registerModelsCommands } from '../src/commands/models.js';
import { registerConfigCommands } from '../src/commands/config.js';

// Resolve package.json via createRequire (ESM-safe CJS require)
// dist/bin/aikb.js → two levels up to apps/cli/package.json
const require = createRequire(import.meta.url);
const pkg = require('../../package.json') as { version: string };

program
  .name('aikb')
  .description('AI Knowledge Base CLI — session memory, vector search, graph store')
  .version(pkg.version)
  .option('--json', 'Output results as JSON (machine-readable)')
  .option('--debug', 'Enable debug logging');

registerSessionCommands(program);
registerVectorCommands(program);
registerGraphCommands(program);
registerModelsCommands(program);
registerConfigCommands(program);

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
