import type { EngineContext } from "../engine/engine.js";
import { registerPickSource, type PickPipelineModule } from "../picking/pick-contributor.js";
import type { Renderable } from "../render/renderable.js";
import type { SceneContext } from "../scene/scene-core.js";

/** @internal One particle renderable plus the GPU resources it owns. */
export interface BuiltParticleRenderable {
    readonly renderable: Renderable;
    dispose(): void;
}

/**
 * @internal Register a particle-owned renderable and its pick source on a scene.
 *
 * Unlike shared deferred scene renderables, particle systems can be disposed while their scene lives
 * (`disposeOnStop`, event-created sub-emitter children), so the returned teardown removes both and frees
 * the renderable's resources. Registrations before the first scene build join the boot drain; later ones
 * are built and inserted live.
 */
export function addParticleSceneRenderable<E>(
    scene: SceneContext,
    pickEntity: E,
    loadPick: () => Promise<PickPipelineModule<E>>,
    build: (engine: EngineContext) => BuiltParticleRenderable | Promise<BuiltParticleRenderable>
): () => void {
    const unregisterPick = registerPickSource(scene, pickEntity, loadPick);
    let built: BuiltParticleRenderable | undefined;
    let disposed = false;
    const install = async (): Promise<void> => {
        const result = await build(scene.surface.engine);
        if (disposed) {
            result.dispose();
            return;
        }
        built = result;
        scene._renderables.push(result.renderable);
        if (scene._built) {
            scene._renderableVersion++;
        }
    };
    const dispose = (): void => {
        if (disposed) {
            return;
        }
        disposed = true;
        unregisterPick();
        // Scene teardown drains `_disposables` before invoking them, so this only matches early disposal.
        const disposableIndex = scene._disposables.indexOf(dispose);
        if (disposableIndex !== -1) {
            scene._disposables.splice(disposableIndex, 1);
        }
        if (built) {
            const renderableIndex = scene._renderables.indexOf(built.renderable);
            if (renderableIndex !== -1) {
                scene._renderables.splice(renderableIndex, 1);
                scene._renderableVersion++;
            }
            built.dispose();
        }
    };
    scene._disposables.push(dispose);
    if (scene._built) {
        void install();
    } else {
        scene._deferredBuilders.push(install);
    }
    return dispose;
}
