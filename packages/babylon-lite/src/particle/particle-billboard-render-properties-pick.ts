import { F32 } from "../engine/typed-arrays.js";
import { getViewMatrix } from "../camera/camera.js";
import type { Mat4, Vec2 } from "../math/types.js";
import { createBillboardPickResources, disposeBillboardPickResources, drawBillboardForPicking, type BillboardPickResources } from "../picking/billboard-pick-pipeline.js";
import type { PickContributor } from "../picking/pick-contributor.js";
import type { FacingBillboardSpriteSystem } from "../sprite/billboard-sprite.js";

/** @internal Entity registered only for particle billboards with a nonzero translation pivot. */
export interface ParticleRenderPropertiesPickSource {
    readonly system: FacingBillboardSpriteSystem;
    readonly translationPivot: Vec2;
}

/** @internal Copy instances and shift anchors so the stock pick shader reproduces the translated-pivot quad exactly. */
export function copyParticleRenderPropertyPickInstances(system: FacingBillboardSpriteSystem, translationPivot: Vec2, view: Mat4, target: Float32Array): void {
    const count = system.count;
    const stride = system._instanceFloatsPerSprite;
    target.set(system._instanceData.subarray(0, count * stride));

    const rightLength = Math.hypot(view[0]!, view[4]!, view[8]!);
    const upLength = Math.hypot(view[1]!, view[5]!, view[9]!);
    const rightX = view[0]! / rightLength;
    const rightY = view[4]! / rightLength;
    const rightZ = view[8]! / rightLength;
    const upX = -view[1]! / upLength;
    const upY = -view[5]! / upLength;
    const upZ = -view[9]! / upLength;

    for (let index = 0; index < count; index++) {
        const offset = index * stride;
        const scaledX = translationPivot.x * target[offset + 3]!;
        const scaledY = translationPivot.y * target[offset + 4]!;
        const angle = target[offset + 9]!;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const deltaX = translationPivot.x - (scaledX * cos - scaledY * sin);
        const deltaY = translationPivot.y - (scaledX * sin + scaledY * cos);
        target[offset] = target[offset]! + rightX * deltaX + upX * deltaY;
        target[offset + 1] = target[offset + 1]! + rightY * deltaX + upY * deltaY;
        target[offset + 2] = target[offset + 2]! + rightZ * deltaX + upZ * deltaY;
    }
}

/** Build the lazy picking contributor for one translated-pivot particle billboard. */
export function createPickContributor(source: ParticleRenderPropertiesPickSource): PickContributor {
    const system = source.system;
    let pickSystem: FacingBillboardSpriteSystem | null = null;
    let resources: BillboardPickResources | null = null;
    return {
        draw(ctx, baseId) {
            const count = system.count;
            if (!system.visible || count === 0) {
                return baseId + count;
            }
            const requiredFloats = system._instanceData.length;
            if (!pickSystem) {
                pickSystem = { ...system, _instanceData: new F32(requiredFloats) } as FacingBillboardSpriteSystem;
            } else if (pickSystem._instanceData.length < requiredFloats) {
                pickSystem._instanceData = new F32(requiredFloats);
            }
            (pickSystem as { count: number }).count = count;
            pickSystem._capacity = system._capacity;
            pickSystem.alphaCutoff = system.alphaCutoff;
            const view = getViewMatrix(ctx.camera);
            copyParticleRenderPropertyPickInstances(system, source.translationPivot, view, pickSystem._instanceData);
            resources ??= createBillboardPickResources(ctx.engine, pickSystem);
            ctx.pass.setBindGroup(0, ctx.sceneBG);
            drawBillboardForPicking(ctx.pass, ctx.engine, pickSystem, resources, baseId, view, ctx.detailed);
            return baseId + count;
        },
        resolve(info, localId) {
            info._spritePick = { system, spriteIndex: localId, pickedPoint: info.pickedPoint, distance: info.distance };
        },
        dispose() {
            if (resources) {
                disposeBillboardPickResources(resources);
                resources = null;
            }
        },
    };
}
