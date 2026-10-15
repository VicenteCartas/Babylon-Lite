import { describe, expect, it } from "vitest";

import type { Mat4 } from "../../../packages/babylon-lite/src/math/types";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene-core";
import type { SpriteAtlas } from "../../../packages/babylon-lite/src/sprite/shared/sprite-atlas";
import type { Texture2D } from "../../../packages/babylon-lite/src/texture/texture-2d";
import { packBillboardPickUbo } from "../../../packages/babylon-lite/src/picking/billboard-pick-pipeline";
import { createAxisLockedBillboardSystem, createFacingBillboardSystem } from "../../../packages/babylon-lite/src/sprite/billboard-sprite";
import { addAxisLockedBillboardSystem, addFacingBillboardSystem } from "../../../packages/babylon-lite/src/sprite/billboard-scene";
import { addBillboardSpriteIndex } from "../../../packages/babylon-lite/src/sprite/billboard-sprite";
import { addFacingBillboardSystemWithParticleRenderProperties } from "../../../packages/babylon-lite/src/particle/particle-billboard-render-properties";
import { copyParticleRenderPropertyPickInstances } from "../../../packages/babylon-lite/src/particle/particle-billboard-render-properties-pick";

function makeMockAtlas(): SpriteAtlas {
    const texture = {
        texture: {} as GPUTexture,
        view: {} as GPUTextureView,
        sampler: {} as GPUSampler,
        width: 128,
        height: 128,
    } satisfies Texture2D;
    return {
        texture,
        textureSizePx: [128, 128],
        frames: [{ uvMin: [0, 0], uvMax: [0.25, 0.25], sourceSizePx: [32, 32], pivot: [0.5, 0.5] }],
        premultipliedAlpha: false,
    };
}

/** A scene stub exposing only the fields the billboard scene-add helpers touch. */
function makeStubScene(): SceneContext {
    return { _pickSources: [], _deferredBuilders: [], _disposables: [] } as unknown as SceneContext;
}

describe("packBillboardPickUbo", () => {
    it("packs camera basis rows, baseId, cutoff, and axis at the right offsets", () => {
        // Column-major view matrix: row 0 = camera right, row 1 = camera up.
        // prettier-ignore
        const view = new Float32Array([
            1, 2, 3, 0, // col 0
            4, 5, 6, 0, // col 1
            7, 8, 9, 0, // col 2
            10, 11, 12, 1, // col 3
        ]) as unknown as Mat4;
        const buf = new ArrayBuffer(48);
        const f32 = new Float32Array(buf);
        const u32 = new Uint32Array(buf);

        packBillboardPickUbo(view, 42, 0.5, [0, 1, 0], f32, u32);

        // camRight = view row 0 = (view[0], view[4], view[8]).
        expect([f32[0], f32[1], f32[2]]).toEqual([1, 4, 7]);
        // baseId at float slot 3 (read as u32).
        expect(u32[3]).toBe(42);
        // camUp = view row 1 = (view[1], view[5], view[9]).
        expect([f32[4], f32[5], f32[6]]).toEqual([2, 5, 8]);
        // cutoff.
        expect(f32[7]).toBe(0.5);
        // axis.
        expect([f32[8], f32[9], f32[10]]).toEqual([0, 1, 0]);
    });

    it("writes baseId as an unsigned integer (not a float)", () => {
        const view = new Float32Array(16) as unknown as Mat4;
        const buf = new ArrayBuffer(48);
        const f32 = new Float32Array(buf);
        const u32 = new Uint32Array(buf);

        packBillboardPickUbo(view, 0x123456, 0, [1, 0, 0], f32, u32);
        expect(u32[3]).toBe(0x123456);
    });
});

describe("billboard scene pick registration", () => {
    it("addFacingBillboardSystem registers a pick source", () => {
        const scene = makeStubScene();
        const system = createFacingBillboardSystem(makeMockAtlas());

        addFacingBillboardSystem(scene, system);

        expect(scene._pickSources).toHaveLength(1);
        // The deferred renderable builder is still queued (rendering path unchanged).
        expect(scene._deferredBuilders.length).toBe(1);
    });

    it("addAxisLockedBillboardSystem registers a pick source", () => {
        const scene = makeStubScene();
        const system = createAxisLockedBillboardSystem(makeMockAtlas(), [0, 1, 0]);

        addAxisLockedBillboardSystem(scene, system);

        expect(scene._pickSources).toHaveLength(1);
    });

    it("registers one pick source per system, in add order", () => {
        const scene = makeStubScene();
        const a = createFacingBillboardSystem(makeMockAtlas());
        const b = createAxisLockedBillboardSystem(makeMockAtlas(), [0, 1, 0]);

        addFacingBillboardSystem(scene, a);
        addAxisLockedBillboardSystem(scene, b);

        expect(scene._pickSources).toHaveLength(2);
    });

    it("disposing removes the system's pick source", () => {
        const scene = makeStubScene();
        addFacingBillboardSystem(scene, createFacingBillboardSystem(makeMockAtlas()));
        expect(scene._pickSources).toHaveLength(1);

        // Running the registered disposers (as scene teardown / entity disposal does) must remove
        // the pick source so a disposed system is never drawn by the picker.
        for (const dispose of scene._disposables) {
            dispose();
        }

        expect(scene._pickSources).toHaveLength(0);
    });
});

describe("particle render-property picking", () => {
    it("shifts transient pick anchors to reproduce translated-pivot geometry, including zero size", () => {
        const system = createFacingBillboardSystem(makeMockAtlas(), { capacity: 1 });
        addBillboardSpriteIndex(system, { position: [1, 2, 3], sizeWorld: [0, 0], rotation: 0.75 });
        const view = new Float32Array(16);
        view[0] = 1;
        view[5] = 1;
        view[10] = 1;
        view[15] = 1;
        const transformed = new Float32Array(system._instanceData.length);

        copyParticleRenderPropertyPickInstances(system, { x: 0.25, y: -0.5 }, view as unknown as Mat4, transformed);

        expect(Array.from(transformed.slice(0, 3))).toEqual([1.25, 2.5, 3]);
        expect(Array.from(system._instanceData.slice(0, 3))).toEqual([1, 2, 3]);
    });

    it("registers the specialized lazy pick source only for a nonzero translation pivot", () => {
        const translatedScene = makeStubScene();
        const translated = createFacingBillboardSystem(makeMockAtlas());
        addFacingBillboardSystemWithParticleRenderProperties(translatedScene, translated, 2, {
            translationPivot: { x: 0.25, y: 0 },
            textureMask: { r: 1, g: 1, b: 1, a: 1 },
            renderingGroupId: 0,
        });
        const ordinaryScene = makeStubScene();
        const ordinary = createFacingBillboardSystem(makeMockAtlas());
        addFacingBillboardSystemWithParticleRenderProperties(ordinaryScene, ordinary, 2, {
            translationPivot: { x: 0, y: 0 },
            textureMask: { r: 0.5, g: 1, b: 1, a: 1 },
            renderingGroupId: 1,
        });

        expect(translatedScene._pickSources[0]!.entity).toMatchObject({ system: translated, translationPivot: { x: 0.25, y: 0 } });
        expect(ordinaryScene._pickSources[0]!.entity).toBe(ordinary);
    });
});
