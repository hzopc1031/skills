// In-memory original-text provenance; JSON job fields cannot replace this context.
const contexts = new WeakMap();
export function rememberPromotionInput(job, original, kind = 'post') {
  contexts.set(job, { original: structuredClone(original), kind });
  return job;
}
export function promotionInput(job) { return contexts.get(job); }
