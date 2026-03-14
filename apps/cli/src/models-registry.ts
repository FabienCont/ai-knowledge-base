/**
 * Local copy of the model registry for the CLI.
 *
 * This avoids loading the full @aikb/core-embeddings bundle (which has
 * native addon dependencies) just to display static model metadata.
 * When new models are added to @aikb/core-embeddings, update this list too.
 */
export interface ModelEntry {
  id: string;
  dimensions: number;
  sizeLabel: string;
  description: string;
  isDefault: boolean;
}

export const CLI_MODEL_REGISTRY: ModelEntry[] = [
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
