import type { ParsedNodeParticleGraph } from "./npe-types.js";

/**
 * Parse a node-particle graph source object (the inner `nodeParticle` payload) into a {@link ParsedNodeParticleGraph}.
 *
 * The serialized shape mirrors Babylon.js `NodeParticleSystemSet.serialize`: a flat `blocks` array where
 * each block carries `customType`, `id`, `name`, and an `inputs` array whose entries reference their source
 * via `targetBlockId` + `targetConnectionName`. `SystemBlock` instances are the graph roots.
 */
export function parseNodeParticleSource(source: unknown): ParsedNodeParticleGraph {
    return source as ParsedNodeParticleGraph;
}
