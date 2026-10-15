import { getViewMatrix } from "../camera/camera.js";
import type { DrawBinding, Renderable } from "../render/renderable.js";

/** Sort-distance offset per Babylon.js rendering group; larger than any practical scene depth range. */
const RENDERING_GROUP_SORT_OFFSET = 1e9;

/**
 * @internal Order a particle renderable after every lower Babylon.js rendering group.
 *
 * Babylon.js draws rendering groups in ascending id order. Lite has no shared rendering-group stage, so a
 * particle renderable in a later group presents its bindings through a sort view whose world center is
 * pulled toward the camera by `groupId` offsets. The shared back-to-front transparent sort then draws it
 * after lower groups while keeping distance order within the same group, and unrelated scenes pay nothing.
 */
export function applyParticleRenderingGroup(renderable: Renderable, groupId: number): void {
    if (!groupId) {
        return;
    }
    const bind = renderable.bind;
    renderable.bind = (engine, target) => {
        const binding = bind(engine, target);
        const center: [number, number, number] = [0, 0, 0];
        const sortView = Object.create(renderable) as Renderable;
        sortView._worldCenter = center;
        const offset = groupId * RENDERING_GROUP_SORT_OFFSET;
        return {
            ...binding,
            renderable: sortView,
            update(context) {
                binding.update?.(context);
                const source = renderable._worldCenter;
                const camera = context._camera;
                if (!source || !camera) {
                    return;
                }
                // Row 2 of the view matrix is the camera's world-space depth axis used by the transparent sort.
                const view = getViewMatrix(camera);
                center[0] = source[0] - offset * view[2]!;
                center[1] = source[1] - offset * view[6]!;
                center[2] = source[2] - offset * view[10]!;
            },
        } satisfies DrawBinding;
    };
}
