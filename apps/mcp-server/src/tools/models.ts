import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { getConfig } from '@aikb/core-config';
import { safeTool } from './safe-tool.js';

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerModelsTools(server: McpServer): void {
  // ─────────────────────────────────────────────────────────────────────────
  // models_list
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'models_list',
    'List available embedding models',
    {},
    async () =>
      safeTool(async () => {
        const { MODEL_REGISTRY } = await import('@aikb/core-embeddings');
        return {
          content: [{ type: 'text', text: JSON.stringify(MODEL_REGISTRY) }],
        };
      }),
  );

  // ─────────────────────────────────────────────────────────────────────────
  // models_download
  // ─────────────────────────────────────────────────────────────────────────
  server.tool(
    'models_download',
    'Pre-download a local embedding model',
    {
      model_id: z.string().describe('HuggingFace model ID to download'),
    },
    async ({ model_id }) =>
      safeTool(async () => {
        const config = await getConfig();
        const { createEmbeddingProvider } = await import('@aikb/core-embeddings');
        const provider = createEmbeddingProvider({
          ...config.embedding,
          provider: 'local',
          model: model_id,
        });
        // Trigger model download by embedding a short text
        await provider.embed('download trigger');
        return {
          content: [{ type: 'text', text: `Downloaded: ${model_id}` }],
        };
      }),
  );
}
