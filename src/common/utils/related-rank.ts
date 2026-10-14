/** Same-category match outweighs tags, which outweigh a matching orientation. */
export const RELATED_CATEGORY_WEIGHT = 10;
export const RELATED_TAG_WEIGHT = 5;
export const RELATED_ORIENTATION_WEIGHT = 2;

export function relatedScore(input: { sharedCategories: number; sharedTags: number; sameOrientation: boolean }): number {
  return (
    (input.sharedCategories > 0 ? RELATED_CATEGORY_WEIGHT : 0) +
    Math.max(0, input.sharedTags) * RELATED_TAG_WEIGHT +
    (input.sameOrientation ? RELATED_ORIENTATION_WEIGHT : 0)
  );
}

export interface RelatedCandidate {
  id: string;
  sharedCategories: number;
  sharedTags: number;
  sameOrientation: boolean;
}

/** Drops the source wallpaper, dedupes ids, and pages a stable score order. Score 0 remains as the published fallback. */
export function rankRelated(sourceId: string, candidates: readonly RelatedCandidate[], page: number, limit: number): RelatedCandidate[] {
  const unique = new Map<string, RelatedCandidate>();
  for (const candidate of candidates) {
    if (!candidate.id || candidate.id === sourceId || unique.has(candidate.id)) continue;
    unique.set(candidate.id, candidate);
  }
  const ranked = [...unique.values()].sort((a, b) => {
    const delta = relatedScore(b) - relatedScore(a);
    if (delta !== 0) return delta;
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  });
  const start = Math.max(0, page - 1) * limit;
  return ranked.slice(start, start + limit);
}
