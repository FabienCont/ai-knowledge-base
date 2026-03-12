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
  ignorePatterns: ['dist/', 'node_modules/', '*.cjs', '*.js', 'vitest.config.ts', 'vitest.workspace.ts'],
};
