import type { SceneContext } from "../scene/scene-core.js";
import type { FacingBillboardSpriteSystem } from "../sprite/billboard-sprite.js";
import { attachParticleMultiplyShader, buildParticleBlendBillboardRenderable } from "./particle-billboard-renderable.js";
import { createParticleBlend } from "./particle-blend.js";
import { addParticleSceneRenderable } from "./particle-scene-renderable.js";

/** Add a facing billboard system using Babylon.js particle Multiply or MultiplyAdd rendering when requested. */
export function addFacingBillboardSystemWithParticleBlend(scene: SceneContext, billboard: FacingBillboardSpriteSystem, blendMode: number): () => void {
    (billboard as { blendMode: FacingBillboardSpriteSystem["blendMode"] }).blendMode = createParticleBlend(blendMode);
    const multiplyPasses = !!billboard.blendMode._particlePasses;
    if (multiplyPasses) {
        attachParticleMultiplyShader(billboard);
    }
    return addParticleSceneRenderable(
        scene,
        billboard,
        () => import("../picking/billboard-pick-pipeline.js"),
        async (engine) => {
            const { buildBillboardRenderable } = await import("./particle-billboard-renderer.js");
            return multiplyPasses ? buildParticleBlendBillboardRenderable(engine, billboard, buildBillboardRenderable) : buildBillboardRenderable(engine, billboard, false);
        }
    );
}
