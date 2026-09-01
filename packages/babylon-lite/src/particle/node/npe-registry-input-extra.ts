import type { NpeBlockEvaluator } from "./npe-build.js";

/** Route uncommon contextual input families after the local-input fast path misses. */
export async function load(): Promise<NpeBlockEvaluator> {
    return (await import("./blocks/particle-input-extra-block.js")).evaluator;
}
