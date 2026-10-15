import { describe, expect, it, vi } from "vitest";
import type { PickPipelineModule } from "../../../packages/babylon-lite/src/picking/pick-contributor";
import { addParticleSceneRenderable } from "../../../packages/babylon-lite/src/particle/particle-scene-renderable";
import type { Renderable } from "../../../packages/babylon-lite/src/render/renderable";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene-core";

function fakeScene(built: boolean): SceneContext {
    return {
        surface: { engine: {} },
        _renderables: [],
        _pickSources: [],
        _deferredBuilders: [],
        _disposables: [],
        _renderableVersion: 0,
        _built: built,
    } as unknown as SceneContext;
}

const loadPick = (): Promise<PickPipelineModule<object>> => Promise.reject(new Error("not used"));

describe("addParticleSceneRenderable", () => {
    it("joins the boot drain before the first scene build without bumping the renderable version", async () => {
        const scene = fakeScene(false);
        const renderable = { order: 1 } as Renderable;
        const build = vi.fn(() => ({ renderable, dispose: vi.fn() }));

        addParticleSceneRenderable(scene, {}, loadPick, build);

        expect(build).not.toHaveBeenCalled();
        expect(scene._pickSources).toHaveLength(1);
        expect(scene._deferredBuilders).toHaveLength(1);
        await scene._deferredBuilders[0]!();
        expect(build).toHaveBeenCalledWith(scene.surface.engine);
        expect(scene._renderables).toEqual([renderable]);
        expect(scene._renderableVersion).toBe(0);
    });

    it("inserts live after scene build and removes everything it owns on early disposal", async () => {
        const scene = fakeScene(true);
        const other = { order: 0 } as Renderable;
        const otherDispose = vi.fn();
        scene._renderables.push(other);
        scene._disposables.push(otherDispose);
        const renderable = { order: 1 } as Renderable;
        const disposeBuilt = vi.fn();

        const dispose = addParticleSceneRenderable(scene, {}, loadPick, async () => ({ renderable, dispose: disposeBuilt }));
        await vi.waitFor(() => expect(scene._renderables).toEqual([other, renderable]));
        expect(scene._deferredBuilders).toHaveLength(0);
        expect(scene._renderableVersion).toBe(1);

        dispose();
        dispose();
        expect(scene._renderables).toEqual([other]);
        expect(scene._disposables).toEqual([otherDispose]);
        expect(scene._pickSources).toEqual([]);
        expect(scene._renderableVersion).toBe(2);
        expect(disposeBuilt).toHaveBeenCalledOnce();
    });

    it("frees a renderable whose async build completes after disposal", async () => {
        const scene = fakeScene(true);
        let resolveBuild!: (value: { renderable: Renderable; dispose: () => void }) => void;
        const disposeBuilt = vi.fn();

        const dispose = addParticleSceneRenderable(scene, {}, loadPick, () => new Promise((resolve) => (resolveBuild = resolve)));
        dispose();
        resolveBuild({ renderable: { order: 1 } as Renderable, dispose: disposeBuilt });

        await vi.waitFor(() => expect(disposeBuilt).toHaveBeenCalledOnce());
        expect(scene._renderables).toEqual([]);
        expect(scene._renderableVersion).toBe(0);
    });
});
