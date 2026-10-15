import type { SceneContext } from "../scene/scene-core.js";
import { addDeferredSceneRenderables } from "../scene/scene-core.js";
import type { AxisLockedBillboardSpriteSystem, BillboardSpriteSystem, FacingBillboardSpriteSystem } from "./billboard-sprite.js";
import { registerPickSource } from "../picking/pick-contributor.js";

function addBillboardSystem(scene: SceneContext, system: BillboardSpriteSystem): () => void {
    // Make this system pickable by registering a pick source (the system + a dynamic-import thunk for
    // its pick pipeline). Pure data — billboard *rendering* pulls no pick-pipeline bytes; the picker
    // builds the contributor on the first pick via the pipeline's `createPickContributor`. The
    // unregister is disposed with the scene so the source doesn't outlive the system.
    const unregisterPick = registerPickSource(scene, system, () => import("../picking/billboard-pick-pipeline.js"));
    const unregisterRender = addDeferredSceneRenderables(scene, async (engine) => {
        const { buildBillboardRenderable } = await import("./billboard-renderable.js");
        const built = buildBillboardRenderable(engine, system);
        return { renderables: [built.renderable], dispose: built.dispose };
    });
    let disposed = false;
    const unregister = () => {
        if (disposed) {
            return;
        }
        disposed = true;
        unregisterPick();
        unregisterRender();
        if (!scene._z) {
            const index = scene._disposables.indexOf(unregister);
            if (index !== -1) {
                scene._disposables.splice(index, 1);
            }
        }
    };
    scene._disposables.splice(scene._disposables.indexOf(unregisterRender), 0, unregister);
    return unregister;
}

/**
 * Adds a camera-facing billboard sprite system to the scene so it is rendered each frame.
 * @param scene - Scene that will own and draw the system.
 * @param system - Facing billboard system to register.
 */
export function addFacingBillboardSystem(scene: SceneContext, system: FacingBillboardSpriteSystem): () => void {
    return addBillboardSystem(scene, system);
}

/**
 * Adds an axis-locked billboard sprite system to the scene so it is rendered each frame.
 * @param scene - Scene that will own and draw the system.
 * @param system - Axis-locked billboard system to register.
 */
export function addAxisLockedBillboardSystem(scene: SceneContext, system: AxisLockedBillboardSpriteSystem): () => void {
    return addBillboardSystem(scene, system);
}
