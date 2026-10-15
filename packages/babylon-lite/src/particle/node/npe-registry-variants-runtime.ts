import type { NpeBlockEvaluator } from "./npe-build.js";
import type { ParsedParticleBlock } from "./npe-types.js";
import { NPE_SYSTEM_CAMERA_POSITION } from "./npe-types.js";

const loadSprite = () => import("./npe-pack-sprite.js");

function usesSystemRenderProperties(block: ParsedParticleBlock): boolean {
    const pivot = block.inputs.find((input) => input.name.trim() === "translationPivot");
    const mask = block.inputs.find((input) => input.name.trim() === "textureMask");
    const pivotValue = pivot?.value;
    const maskValue = mask?.value;
    return (
        (pivot?.targetBlockId != null && pivot.targetConnectionName != null) ||
        (mask?.targetBlockId != null && mask.targetConnectionName != null) ||
        (pivot?.valueType === "BABYLON.Vector2" && Array.isArray(pivotValue) && ((pivotValue[0] ?? 0) !== 0 || (pivotValue[1] ?? 0) !== 0)) ||
        (mask?.valueType === "BABYLON.Color4" &&
            Array.isArray(maskValue) &&
            ((maskValue[0] ?? 0) !== 1 || (maskValue[1] ?? 0) !== 1 || (maskValue[2] ?? 0) !== 1 || (maskValue[3] ?? 1) !== 1)) ||
        (typeof block.renderingGroupId === "number" && block.renderingGroupId !== 0)
    );
}

function usesSystemBillboardMode(block: ParsedParticleBlock): boolean {
    return block.isBillboardBased === false || (typeof block.billBoardMode === "number" && block.billBoardMode !== 7);
}

/** Resolve serialized variants outside the direct contextual-input paths. */
export async function loadVariantBlockEvaluator(block: ParsedParticleBlock): Promise<NpeBlockEvaluator> {
    const contextualSource = typeof block.contextualValue === "number" ? block.contextualValue : 0;
    if (block.customType === "BABYLON.SystemBlock" && usesSystemBillboardMode(block)) {
        return (await import("./npe-pack-billboard-modes.js")).load("SystemBlock");
    }
    if (block.customType === "BABYLON.SystemBlock" && usesSystemRenderProperties(block)) {
        return (await import("./npe-pack-render-properties.js")).load("SystemBlock");
    }
    if (block.customType === "BABYLON.ParticleInputBlock" && contextualSource === 0 && block.systemSource === NPE_SYSTEM_CAMERA_POSITION) {
        return (await import("./npe-pack-camera.js")).load("ParticleInputBlock");
    }
    if (block.customType === "BABYLON.SetupSpriteSheetBlock" && block.randomStartCell === true) {
        return (await loadSprite()).loadRandomStartSpriteBlockEvaluator();
    }
    return (await import("./npe-registry-variants-extra.js")).load(block);
}

export { loadVariantBlockEvaluator as load };
