/** Pick contributor — the pluggable pick contract, analogous to `Renderable` for drawing.
 *
 *  The GPU picker draws meshes itself (the always-present base case, kept intrinsic so a
 *  scene that never picks pays zero pick bytes), then iterates `scene._pickContributors`
 *  with no knowledge of any specific entity type. Each *optional* pickable entity (a
 *  Gaussian-splatting mesh, a billboard system, …) registers one contributor when it is
 *  added to the scene. Adding a new pickable type is a new module that calls
 *  `registerPickContributor` — no edits to `gpu-picker.ts` or `scene-core.ts`.
 *
 *  Contributors draw into the SAME 1×1 pick pass as meshes (shared pick-id colour target,
 *  `r32float` depth, and reverse-Z depth test), so occlusion is respected across entity
 *  types. Each contributor owns a contiguous pick-id range assigned by the picker. */

import type { EngineContext } from "../engine/engine.js";
import type { SceneContext } from "../scene/scene-core.js";
import type { Camera } from "../camera/camera.js";
import type { PickingInfo } from "./picking-info.js";
import type { GpuPicker } from "./gpu-picker.js";

/** Shared state for the single 1×1 pick pass, handed to each contributor's `draw`. */
export interface PickPassContext {
    /** The picker running this pass — contributors cache per-picker GPU state on `_contributorState`. */
    readonly picker: GpuPicker;
    /** The open pick render pass (meshes already drawn into ids `1..M`). */
    readonly pass: GPURenderPassEncoder;
    readonly engine: EngineContext;
    readonly scene: SceneContext;
    readonly camera: Camera;
    /** Group-0 bind group holding the pick-zoomed view-projection (the mesh pick scene UBO).
     *  A contributor that rebinds group 0 (e.g. GS) must expect the next contributor to rebind
     *  what it needs; contributors that reuse the mesh VP rebind this at the start of `draw`. */
    readonly sceneBG: GPUBindGroup;
    /** Pick pixel + pick-viewport size (canvas space), for contributors that build their own pick matrix. */
    readonly px: number;
    readonly py: number;
    readonly w: number;
    readonly h: number;
}

/** Per-picker GPU state a contributor caches (keyed by the contributor on the picker).
 *  `dispose` is captured at draw time so the picker can free it synchronously and generically,
 *  without knowing the entity type or re-importing the heavy pipeline module. */
export interface PickContributorState {
    dispose(): void;
}

/** A pluggable pick handler for one optional pickable entity. Registered on the scene when the
 *  entity is added; the picker iterates contributors with no entity-type knowledge. */
export interface PickContributor {
    /** Draw this entity's pickables into the shared pass, assigning ids from `baseId`.
     *  Returns the next free id, so `nextId - baseId` is the id count this contributor owns
     *  (a hidden/empty entity still consumes its ids so id↔entity mapping stays positional).
     *  May be async so heavy pick-pipeline code can be lazy-imported on first pick. */
    draw(ctx: PickPassContext, baseId: number): Promise<number>;
    /** Resolve a read-back id owned by this contributor (`localId = pickId - baseId`) by
     *  attaching its payload to `info`. `info.pickedPoint` / `info.distance` are already set
     *  from the shared pick-depth readback. */
    resolve(info: PickingInfo, localId: number): void;
}

/** Register a pick contributor on the scene. Called by entity modules when the entity is added
 *  (mirrors pushing a `Renderable`). Returns an unregister function for the entity's disposer. */
export function registerPickContributor(scene: SceneContext, contributor: PickContributor): () => void {
    scene._pickContributors.push(contributor);
    return () => {
        const i = scene._pickContributors.indexOf(contributor);
        if (i >= 0) {
            scene._pickContributors.splice(i, 1);
        }
    };
}
