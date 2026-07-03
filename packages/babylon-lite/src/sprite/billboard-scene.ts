import type { SceneContext } from "../scene/scene-core.js";
import { addDeferredSceneRenderables } from "../scene/scene-core.js";
import type { AxisLockedBillboardSpriteSystem, BillboardSpriteSystem, FacingBillboardSpriteSystem } from "./billboard-sprite.js";
import { registerPickContributor } from "../picking/pick-contributor.js";

function addBillboardSystem(scene: SceneContext, system: BillboardSpriteSystem): void {
    // Register a pick-contributor factory so `pickBillboardSprite` hits this system's sprites in the
    // shared depth-sorted pick pass. The factory is a thin dynamic-import thunk, so billboard
    // *rendering* pulls no pick-pipeline bytes — the picker builds the contributor on the first pick.
    scene._disposables.push(registerPickContributor(scene, () => import("../picking/billboard-pick-pipeline.js").then((m) => m.createBillboardPickContributor(system))));
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
