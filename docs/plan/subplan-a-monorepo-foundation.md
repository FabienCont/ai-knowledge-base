# ⬜ Subplan A — Monorepo Foundation

## Overview

Set up the pnpm monorepo skeleton that all other subplans build upon. This includes the workspace configuration, root tooling (TypeScript, ESLint, Prettier, Vitest), and a working build pipeline using `tsup`. Every subsequent package/app will extend the artifacts created here.

---

## Dependencies

- None (this is the foundation)

---

## Detailed Tasks

### A1 ⬜ Initialize repository & Node version

- Create `.nvmrc` with content `20`
- Confirm `node --version` ≥ 20 in CI
- Create `.gitignore`:
  ```
  node_modules/
  dist/
  .turbo/
  *.tsbuildinfo
  .env
  .env.local
  coverage/
  .DS_Store
  ```

### A2 ⬜ pnpm workspace

- Create `pnpm-workspace.yaml`:
  ```yaml
  packages:
    - 'packages/*'
    - 'apps/*'
  ```
- Create root `package.json`:
  ```json
  {
    "name": "ai-knowledge-base",
    "private": true,
    "version": "0.0.0",
    "type": "module",
    "engines": { "node": ">=20", "pnpm": ">=8" },
    "scripts": {
      "build": "pnpm -r --filter='./packages/*' --filter='./apps/*' build",
      "test": "vitest run --workspace vitest.workspace.ts",
      "test:watch": "vitest --workspace vitest.workspace.ts",
      "lint": "eslint . --ext .ts,.tsx",
      "typecheck": "tsc --build --force",
      "dev": "pnpm -r --parallel dev",
      "clean": "pnpm -r exec rm -rf dist .turbo *.tsbuildinfo"
    },
    "devDependencies": {
      "typescript": "^5.4.0",
      "vitest": "^1.6.0",
      "@vitest/coverage-v8": "^1.6.0",
      "tsup": "^8.0.0",
      "tsx": "^4.7.0",
      "eslint": "^8.57.0",
      "@typescript-eslint/eslint-plugin": "^7.0.0",
      "@typescript-eslint/parser": "^7.0.0",
      "prettier": "^3.2.0",
      "eslint-config-prettier": "^9.1.0"
    }
  }
  ```

### A3 ⬜ TypeScript base config

- Create `tsconfig.base.json` at repo root:
  ```json
  {
    "compilerOptions": {
      "target": "ES2022",
      "module": "NodeNext",
      "moduleResolution": "NodeNext",
      "lib": ["ES2022"],
      "strict": true,
      "exactOptionalPropertyTypes": true,
      "noUncheckedIndexedAccess": true,
      "noImplicitOverride": true,
      "declaration": true,
      "declarationMap": true,
      "sourceMap": true,
      "composite": true,
      "incremental": true,
      "esModuleInterop": true,
      "skipLibCheck": true,
      "forceConsistentCasingInFileNames": true,
      "resolveJsonModule": true,
      "outDir": "dist"
    }
  }
  ```
- Create root `tsconfig.json` (project references only):
  ```json
  {
    "files": [],
    "references": [
      { "path": "packages/core-types" },
      { "path": "packages/core-config" },
      { "path": "packages/core-fs-scan" },
      { "path": "packages/core-chunking" },
      { "path": "packages/core-embeddings" },
      { "path": "packages/session-memory" },
      { "path": "packages/vector-store" },
      { "path": "packages/graph-store" },
      { "path": "apps/cli" },
      { "path": "apps/mcp-server" }
    ]
  }
  ```

### A4 ⬜ ESLint + Prettier

- Create `.eslintrc.cjs`:
  ```js
  module.exports = {
    root: true,
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint'],
    extends: [
      'eslint:recommended',
      'plugin:@typescript-eslint/recommended-type-checked',
      'prettier',
    ],
    parserOptions: {
      project: true,
      tsconfigRootDir: __dirname,
    },
    env: { node: true, es2022: true },
    ignorePatterns: ['dist/', 'node_modules/', '*.cjs', '*.js'],
  };
  ```
- Create `.prettierrc`:
  ```json
  {
    "semi": true,
    "singleQuote": true,
    "trailingComma": "all",
    "printWidth": 100,
    "tabWidth": 2
  }
  ```

### A5 ⬜ Vitest workspace config

- Create `vitest.workspace.ts` at repo root:
  ```ts
  import { defineWorkspace } from 'vitest/config';

  export default defineWorkspace([
    'packages/*/vitest.config.ts',
    'apps/*/vitest.config.ts',
  ]);
  ```
- Each package's `vitest.config.ts` template:
  ```ts
  import { defineConfig } from 'vitest/config';

  export default defineConfig({
    test: {
      globals: true,
      environment: 'node',
      coverage: {
        provider: 'v8',
        reporter: ['text', 'lcov'],
      },
    },
  });
  ```

### A6 ⬜ Package template

Create a reusable template for every package under `packages/*`. Each package needs:

```
packages/<name>/
├── src/
│   └── index.ts          ← barrel export
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

`package.json` template for a package:
```json
{
  "name": "@aikb/<name>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./dist/index.cjs",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "require": "./dist/index.cjs",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm,cjs --dts --clean",
    "dev": "tsup src/index.ts --format esm,cjs --dts --watch",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`tsconfig.json` template:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist"
  },
  "include": ["src"],
  "references": []
}
```

### A7 ⬜ Optional Turborepo

- If build caching is desired: `pnpm add -Dw turbo`
- Create `turbo.json`:
  ```json
  {
    "$schema": "https://turbo.build/schema.json",
    "pipeline": {
      "build": { "dependsOn": ["^build"], "outputs": ["dist/**"] },
      "test": { "dependsOn": ["build"] },
      "lint": {},
      "typecheck": { "dependsOn": ["^build"] }
    }
  }
  ```
- Update root scripts to use `turbo run build` etc.

### A8 ⬜ Stub all packages

Create placeholder `src/index.ts` for every package/app defined in the workspace (so `pnpm -r build` succeeds end-to-end):

```ts
// packages/core-types/src/index.ts
export const TODO = 'core-types: not yet implemented';
```

---

## File Structure

```
ai-knowledge-base/
├── .gitignore
├── .nvmrc
├── .eslintrc.cjs
├── .prettierrc
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
├── vitest.workspace.ts
├── turbo.json          (optional)
└── packages/           (stubs only at this stage)
    └── core-types/src/index.ts
    └── ...
```

---

## Key APIs / Interfaces

No runtime exports — this subplan is pure tooling configuration.

---

## Acceptance Criteria

- [ ] `pnpm install` completes without errors
- [ ] `pnpm -r build` compiles all packages successfully
- [ ] `pnpm -r test` runs (even with zero tests — just must not crash)
- [ ] `pnpm lint` reports no errors on the stub files
- [ ] `pnpm typecheck` passes with `--build`
- [ ] Each package stub produces `dist/index.js`, `dist/index.cjs`, `dist/index.d.ts`

---

## Notes for Implementers

- Use `"type": "module"` at the root so all `.ts` files are treated as ESM.
- `tsup` handles the dual CJS/ESM output automatically; no need for manual `package.json` exports hacks.
- The `composite: true` + `incremental: true` flags in `tsconfig.base.json` are required for project references to work.
- Avoid `"paths"` in tsconfig — use workspace protocol (`workspace:*`) in `package.json` dependencies instead.
- All packages should use `"@aikb/<name>"` as their npm name to make cross-package imports clean: `import { ... } from '@aikb/core-types'`.
