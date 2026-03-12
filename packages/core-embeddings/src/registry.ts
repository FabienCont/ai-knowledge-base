export interface ModelInfo {
  /** HuggingFace model ID */
  id: string;
  /** Output vector dimension count */
  dimensions: number;
  /** Human-readable size label, e.g. '~23MB' */
  sizeLabel: string;
  /** Short description of the model's characteristics */
  description: string;
  /** Whether this is the default model */
  isDefault: boolean;
}

export const MODEL_REGISTRY: ModelInfo[] = [
  {
    id: 'Xenova/all-MiniLM-L6-v2',
    dimensions: 384,
    sizeLabel: '~23MB',
    description: 'Fastest, zero-config — recommended default',
    isDefault: true,
  },
  {
    id: 'Xenova/bge-small-en-v1.5',
    dimensions: 384,
    sizeLabel: '~33MB',
    description: 'Better retrieval quality, small size',
    isDefault: false,
  },
  {
    id: 'nomic-ai/nomic-embed-text-v1.5',
    dimensions: 768,
    sizeLabel: '~130MB',
    description: 'High quality, larger model',
    isDefault: false,
  },
  {
    id: 'Snowflake/snowflake-arctic-embed-m',
    dimensions: 768,
    sizeLabel: '~110MB',
    description: 'High quality alternative',
    isDefault: false,
  },
  {
    id: 'Supabase/gte-small',
    dimensions: 384,
    sizeLabel: '~33MB',
    description: 'Balanced quality and size',
    isDefault: false,
  },
];

/** The default model (`Xenova/all-MiniLM-L6-v2`, 384 dimensions). */
export const DEFAULT_MODEL = MODEL_REGISTRY.find((m) => m.isDefault)!;

/**
 * Look up a model by its HuggingFace model ID.
 * Returns `undefined` if the model is not in the registry.
 */
export function getModelInfo(modelId: string): ModelInfo | undefined {
  return MODEL_REGISTRY.find((m) => m.id === modelId);
}
