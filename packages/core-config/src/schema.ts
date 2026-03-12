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
  default_exclude: z
    .array(z.string())
    .default([
      '**/node_modules/**',
      '**/.git/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
    ]),
  max_file_size_bytes: z
    .number()
    .int()
    .positive()
    .default(5 * 1024 * 1024), // 5MB
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
