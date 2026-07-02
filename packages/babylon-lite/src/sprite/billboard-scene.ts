import type { SceneContext } from "../scene/scene-core.js";
import { addDeferredSceneRenderables } from "../scene/scene-core.js";
import type { AxisLockedBillboardSpriteSystem, BillboardSpriteSystem, FacingBillboardSpriteSystem } from "./billboard-sprite.js";
import type { PickContributor } from "../picking/pick-contributor.js";
import { registerPickContributor } from "../picking/pick-contributor.js";
import type { BillboardPickResources } from "../picking/billboard-pick-pipeline.js";

/** Build the (lightweight) pick contributor for one billboard system. The heavy pick pipeline is
 *  lazy-imported inside `draw`, so billboard *rendering* pulls no pick code; per-picker GPU pick
 *  resources are cached on the picker and disposed generically. */
function makeBillboardPickContributor(system: BillboardSpriteSystem): PickContributor {
    const contributor: PickContributor = {
        async draw(ctx, baseId) {
            const count = system.count;
            if (!system.visible || count === 0) {
                return baseId + count; // consume the id range, but nothing to draw
            }
            const m = await import("../picking/billboard-pick-pipeline.js");
            let state = ctx.picker._contributorState?.get(contributor) as { res: BillboardPickResources; dispose(): void } | undefined;
            if (!state) {
                const res = m.createBillboardPickResources(ctx.engine, system);
                state = { res, dispose: () => m.disposeBillboardPickResources(res) };
                (ctx.picker._contributorState ??= new Map()).set(contributor, state);
            }
            m.drawBillboardSystemForPicking(ctx, system, state.res, baseId);
            return baseId + count;
        },
        resolve(info, localId) {
            info._spritePick = { system, spriteIndex: localId, pickedPoint: info.pickedPoint, distance: info.distance };
        },
    };
    return contributor;
}

function addBillboardSystem(scene: SceneContext, system: BillboardSpriteSystem): void {
    // Register a pick contributor so `pickBillboardSprite` hits this system's sprites in the shared
    // depth-sorted pick pass. Lightweight: the pick pipeline is lazy-imported on the first pick, so
    // billboard rendering pulls no pick code.
    scene._disposables.push(registerPickContributor(scene, makeBillboardPickContributor(system)));
    addDeferredSceneRenderables(scene, async (engine) => {
        const { buildBillboardRenderable } = await import("./billboard-renderable.js");
        const built = buildBillboardRenderable(engine, system);
        return { renderables: [built.renderable], dispose: built.dispose };
    });
}

/**
 * Adds a camera-facing billboard sprite system to the scene so it is rendered each frame.
 * @param scene - Scene that will own and draw the system.
 * @param system - Facing billboard system to register.
 */
export function addFacingBillboardSystem(scene: SceneContext, system: FacingBillboardSpriteSystem): void {
    addBillboardSystem(scene, system);
}

/**
 * Adds an axis-locked billboard sprite system to the scene so it is rendered each frame.
 * @param scene - Scene that will own and draw the system.
 * @param system - Axis-locked billboard system to register.
 */
export function addAxisLockedBillboardSystem(scene: SceneContext, system: AxisLockedBillboardSpriteSystem): void {
    addBillboardSystem(scene, system);
}
