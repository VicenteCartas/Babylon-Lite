import type { NpeBlockEvaluator } from "./npe-build.js";
import type { ParsedParticleBlock } from "./npe-types.js";
import { NPE_SYSTEM_CAMERA_POSITION } from "./npe-types.js";

const loadSprite = () => import("./npe-pack-sprite.js");

/** Resolve serialized variants outside the direct contextual-input paths. */
export async function loadVariantBlockEvaluator(block: ParsedParticleBlock): Promise<NpeBlockEvaluator> {
    const contextualSource = typeof block.contextualValue === "number" ? block.contextualValue : 0;
    if (block.customType === "BABYLON.ParticleInputBlock" && contextualSource === 0 && block.systemSource === NPE_SYSTEM_CAMERA_POSITION) {
        return (await import("./npe-pack-camera.js")).load("ParticleInputBlock");
    }
    if (block.customType === "BABYLON.SetupSpriteSheetBlock" && block.randomStartCell === true) {
        return (await loadSprite()).loadRandomStartSpriteBlockEvaluator();
    }
    return (await import("./npe-registry-variants-extra.js")).load(block);
}

export { loadVariantBlockEvaluator as load };
