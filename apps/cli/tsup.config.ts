import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { 'bin/aikb': 'bin/aikb.ts' },
  format: ['esm'],
  dts: false,
  clean: true,
  banner: {
    js: '#!/usr/bin/env node',
  },
  outDir: 'dist',
  // Don't bundle these workspace/node_modules — resolved at runtime
  external: ['openai'],
});
