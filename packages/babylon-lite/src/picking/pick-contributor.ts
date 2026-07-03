/** Pick contributor — the pluggable pick contract, analogous to `Renderable` for drawing.
 *
 *  The GPU picker draws meshes itself (the always-present base case, kept intrinsic so a
 *  scene that never picks pays zero pick bytes), then iterates `scene._pickContributors`
 *  with no knowledge of any specific entity type. Each *optional* pickable entity (a
 *  Gaussian-splatting mesh, a billboard system, …) registers one contributor *factory* when it
 *  is added to the scene. Adding a new pickable type is a new module that calls
 *  `registerPickContributor` — no edits to `gpu-picker.ts` or `scene-core.ts`.
 *
 *  A factory is a `() => Promise<PickContributor>` thunk whose body reaches the (heavy) pick
 *  pipeline only through a dynamic `import()`, so *rendering* an entity pulls only the tiny thunk
 *  + this push; the pipeline, GPU-resource, and resolve code stay in a split chunk the picker
 *  fetches on the first pick. The picker builds each contributor once (per picker) and caches it,
 *  so a contributor's GPU state lives in its closure and disposes generically.
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
    /** The picker running this pass. */
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

/** A pluggable pick handler for one optional pickable entity. Built lazily (once per picker) by a
 *  factory the entity registered when it was added; the picker iterates contributors with no
 *  entity-type knowledge. Reused across picks, so `draw` may cache GPU resources in its closure
 *  and free them in `dispose`. */
export interface PickContributor {
    /** Draw this entity's pickables into the shared pass, assigning ids from `baseId`.
     *  Returns the next free id, so `nextId - baseId` is the id count this contributor owns
     *  (a hidden/empty entity still consumes its ids so id↔entity mapping stays positional). */
    draw(ctx: PickPassContext, baseId: number): number;
    /** Resolve a read-back id owned by this contributor (`localId = pickId - baseId`) by
     *  attaching its payload to `info`. `info.pickedPoint` / `info.distance` are already set
     *  from the shared pick-depth readback. */
    resolve(info: PickingInfo, localId: number): void;
    /** Free any GPU resources this contributor created (called by `disposePicker`). */
    dispose?(): void;
}

/** A thunk that lazy-imports its pick pipeline and builds the contributor for one entity.
 *  Registered on the scene at entity-add time; invoked (once per picker) on the first pick. */
export type PickContributorFactory = () => Promise<PickContributor>;

/** Register a pick-contributor factory on the scene. Called by entity modules when the entity is
 *  added (mirrors pushing a `Renderable`). The factory stays a thin dynamic-import thunk, so
 *  rendering the entity pulls no pick-pipeline bytes. Returns an unregister function for the
 *  entity's disposer. */
export function registerPickContributor(scene: SceneContext, factory: PickContributorFactory): () => void {
    scene._pickContributors.push(factory);
    return () => {
        const i = scene._pickContributors.indexOf(factory);
        if (i >= 0) {
            scene._pickContributors.splice(i, 1);
        }
    };
}
