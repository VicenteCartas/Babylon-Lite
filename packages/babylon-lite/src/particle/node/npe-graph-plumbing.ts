import type { ParsedNodeParticleGraph } from "./npe-types.js";

/**
 * Graph plumbing (Teleport, LocalVariable, Elbow, Debug) is now resolved by every node-particle builder.
 *
 * @deprecated Pass the graph returned by parseNodeParticleSource directly to a builder. This pass-through remains for
 * callers written against the earlier explicit-normalization API.
 * @param graph - A graph returned by parseNodeParticleSource.
 * @returns The same graph.
 */
export async function normalizeNodeParticleGraph(graph: ParsedNodeParticleGraph): Promise<ParsedNodeParticleGraph> {
    return graph;
}