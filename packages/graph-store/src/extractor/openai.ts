import OpenAI from 'openai';
import type { LLMConfig } from '@aikb/core-config';
import type { EmbeddingProvider } from '@aikb/core-embeddings';
import type { Entity, Chunk } from '@aikb/core-types';
import type { Extractor, ExtractionResult, EntityCandidate } from './types.js';
import { LLMExtractionSchema } from './types.js';
import { EXTRACTION_SYSTEM_PROMPT } from './prompts.js';
import { resolveEntities } from './resolution.js';
import type { GraphStore } from '../types.js';

export class OpenAIExtractor implements Extractor {
  private readonly config: LLMConfig;
  private readonly client: OpenAI;

  constructor(config: LLMConfig) {
    this.config = config;
    this.client = new OpenAI({
      apiKey: config.api_key ?? 'no-key',
      ...(config.base_url !== undefined ? { baseURL: config.base_url } : {}),
    });
  }

  async extractFromChunk(chunk: Chunk): Promise<ExtractionResult> {
    const response = await this.client.chat.completions.create({
      model: this.config.model,
      temperature: this.config.temperature,
      max_tokens: this.config.max_tokens,
      messages: [
        { role: 'system', content: EXTRACTION_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Extract entities and relations from:\n\n${chunk.content}`,
        },
      ],
      response_format: { type: 'json_object' },
    });

    const raw: unknown = JSON.parse(
      response.choices[0]?.message.content ?? '{}',
    );
    const parsed = LLMExtractionSchema.parse(raw);

    return {
      entities: parsed.entities.map((e) => ({
        name: e.name,
        type: e.type,
        description: e.description,
        aliases: e.aliases,
        source_chunk_ids: [chunk.id],
      })),
      relations: parsed.relations.map((r) => ({
        subject_name: r.subject_name,
        subject_type: r.subject_type,
        predicate: r.predicate,
        object_name: r.object_name,
        object_type: r.object_type,
        ...(r.confidence !== undefined ? { confidence: r.confidence } : {}),
      })),
    };
  }

  resolveEntities(
    candidates: EntityCandidate[],
    store: GraphStore,
    embeddingProvider: EmbeddingProvider,
  ): Promise<Entity[]> {
    return resolveEntities(candidates, store, embeddingProvider);
  }
}
