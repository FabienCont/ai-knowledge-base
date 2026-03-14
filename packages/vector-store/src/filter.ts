/**
 * Converts a simple filter object from `Query.filter` into a Qdrant filter
 * expression.
 *
 * Supported filter shapes (examples):
 * ```
 * // exact match
 * { source_path: "src/index.ts" }
 *
 * // prefix match
 * { source_path: { prefix: "src/" } }
 *
 * // list of allowed values (any-of)
 * { language: { any: ["ts", "js"] } }
 * ```
 */
export function buildQdrantFilter(
  filter: Record<string, unknown>,
): QdrantFilter {
  const must: QdrantCondition[] = [];

  for (const [key, value] of Object.entries(filter)) {
    if (value === null || value === undefined) continue;

    if (['string', 'number', 'boolean'].includes(typeof value)) {
      // Exact match
      must.push({ key, match: { value: value as string | number | boolean } });
    } else if (typeof value === 'object' && !Array.isArray(value)) {
      const v = value as Record<string, unknown>;

      if ('prefix' in v && typeof v['prefix'] === 'string') {
        // Prefix match — Qdrant uses `text` field for prefix
        must.push({ key, match: { text: v['prefix'] } });
      } else if ('any' in v && Array.isArray(v['any'])) {
        // Any-of match
        must.push({ key, match: { any: v['any'] as (string | number)[] } });
      } else if ('value' in v) {
        // Explicit value wrapper — only emit for supported primitive types;
        // ignore unsupported shapes to avoid invalid Qdrant filter conditions.
        const val = v['value'];
        if (
          typeof val === 'string' ||
          typeof val === 'number' ||
          typeof val === 'boolean'
        ) {
          must.push({ key, match: { value: val } });
        }
      } else if ('gt' in v || 'gte' in v || 'lt' in v || 'lte' in v) {
        // Range match — only include defined bounds
        const range: { gt?: number; gte?: number; lt?: number; lte?: number } = {};
        if (typeof v['gt'] === 'number') range.gt = v['gt'];
        if (typeof v['gte'] === 'number') range.gte = v['gte'];
        if (typeof v['lt'] === 'number') range.lt = v['lt'];
        if (typeof v['lte'] === 'number') range.lte = v['lte'];
        must.push({ key, range });
      }
    }
  }

  return { must };
}

// ---------------------------------------------------------------------------
// Minimal Qdrant filter types (avoids importing private SDK types)
// ---------------------------------------------------------------------------

export interface QdrantFilter {
  must?: QdrantCondition[];
  should?: QdrantCondition[];
  must_not?: QdrantCondition[];
}

export type QdrantCondition =
  | { key: string; match: { value: string | number | boolean } }
  | { key: string; match: { text: string } }
  | { key: string; match: { any: (string | number)[] } }
  | {
      key: string;
      range: {
        gt?: number;
        gte?: number;
        lt?: number;
        lte?: number;
      };
    };
