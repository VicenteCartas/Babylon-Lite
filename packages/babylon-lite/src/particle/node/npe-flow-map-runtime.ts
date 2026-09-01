import type { EngineContext } from "../../engine/engine.js";
import type { SceneContext } from "../../scene/scene.js";
import { buildNodeParticleSet, type BuildNodeParticleOptions, type NodeParticleSet } from "./npe-build.js";
import type { NodeParticleProgram } from "./npe-types.js";

/** @internal Dynamically loaded implementation for the public flow-map builder. */
export async function buildNodeParticleSetWithFlowMapsRuntime(
    engine: EngineContext,
    scene: SceneContext,
    program: NodeParticleProgram,
    options: BuildNodeParticleOptions
): Promise<NodeParticleSet> {
    return buildNodeParticleSet(engine, scene, program, options);
}
