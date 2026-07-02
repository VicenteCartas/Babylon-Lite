/** Lightweight GS pick-contributor registration.
 *
 *  Kept out of the heavy `gs-picking-pipeline` module so that GS *rendering* pulls only this tiny
 *  registration: the pick pipeline (WGSL, GPU resources) stays behind the dynamic import inside
 *  `draw`, fetched only when a pick actually runs on a scene that has GS meshes. Each GS mesh owns
 *  exactly one pick id. */

import type { SceneContext } from "../../scene/scene-core.js";
import type { GaussianSplattingMesh } from "./gaussian-splatting-mesh.js";
import type { PickContributor } from "../../picking/pick-contributor.js";
import { registerPickContributor } from "../../picking/pick-contributor.js";
import type { GsPickMeshResources } from "../../picking/gs-picking-pipeline.js";

/** Register a GS mesh as a pick contributor (one pick id per mesh). Returns an unregister fn. */
export function registerGsPickContributor(scene: SceneContext, mesh: GaussianSplattingMesh): () => void {
    const contributor: PickContributor = {
        async draw(ctx, baseId) {
            const m = await import("../../picking/gs-picking-pipeline.js");
            let state = ctx.picker._contributorState?.get(contributor) as { res: GsPickMeshResources; dispose(): void } | undefined;
            if (!state) {
                const res = m.createGsPickMeshResources(ctx.engine, mesh);
                state = { res, dispose: () => m.disposeGsPickMeshResources(res) };
                (ctx.picker._contributorState ??= new Map()).set(contributor, state);
            }
            m.drawGsMeshForPicking(ctx, mesh, state.res, baseId);
            return baseId + 1;
        },
        resolve(info) {
            info.pickedMesh = mesh;
        },
    };
    return registerPickContributor(scene, contributor);
}
