import type { EngineContext } from "../../engine/engine.js";
import type { SceneContext } from "../../scene/scene.js";
import { addFacingBillboardSystemWithParticleBlend } from "../particle-billboard-scene.js";
import { buildNodeParticleSet } from "./npe-build.js";
import type { BuildNodeParticleOptions, NodeParticleSet } from "./npe-build.js";
import type { ParticleSystem } from "../particle-system.js";
import type { ParsedNodeParticleGraph } from "./npe-types.js";

function enableBlendMode(system: ParticleSystem): ParticleSystem {
    system._registerBillboard ??= (scene, billboard) => addFacingBillboardSystemWithParticleBlend(scene, billboard, system.blendMode);
    return system;
}

/** Enable exact Babylon.js particle blend rendering on any built NPE set. */
export function enableNodeParticleBlendModes(set: NodeParticleSet): NodeParticleSet {
    for (const system of set.systems) {
        enableBlendMode(system);
    }
    return set;
}

/**
 * Build an NPE set with exact Babylon.js particle blend rendering enabled.
 */
export async function buildNodeParticleSetWithBlendModes(
    engine: EngineContext,
    scene: SceneContext,
    graph: ParsedNodeParticleGraph,
    options: BuildNodeParticleOptions = {}
): Promise<NodeParticleSet> {
    return enableNodeParticleBlendModes(await buildNodeParticleSet(engine, scene, graph, options));
}
