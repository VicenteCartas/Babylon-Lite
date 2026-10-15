import { describe, expect, it, vi } from "vitest";

const gpuGlobals = globalThis as Omit<typeof globalThis, "GPUBufferUsage"> & { GPUBufferUsage?: { UNIFORM: number; COPY_DST: number } };
gpuGlobals.GPUBufferUsage ??= { UNIFORM: 0x40, COPY_DST: 0x8 } as unknown as GPUBufferUsage;

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { NpeBuildContext } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { buildNodeParticleSet } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { loadRenderPropertiesBlockEvaluator } from "../../../packages/babylon-lite/src/particle/node/npe-pack-render-properties";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import type { ParsedParticleBlock } from "../../../packages/babylon-lite/src/particle/node/npe-types";
import { createParticleBillboard } from "../../../packages/babylon-lite/src/particle/particle-billboard";
import {
    addFacingBillboardSystemWithParticleRenderProperties,
    buildParticleRenderPropertiesBillboardRenderable,
    PARTICLE_RENDER_PROPERTIES_UBO_BYTES,
} from "../../../packages/babylon-lite/src/particle/particle-billboard-render-properties";
import { createParticleSystem } from "../../../packages/babylon-lite/src/particle/particle-system";
import type { Renderable } from "../../../packages/babylon-lite/src/render/renderable";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";
import type { Texture2D } from "../../../packages/babylon-lite/src/texture/texture-2d";

function systemSource(inputs: Array<Record<string, unknown>>, properties: Record<string, unknown> = {}, blocks: Array<Record<string, unknown>> = []): unknown {
    return {
        blocks: [
            ...blocks,
            {
                customType: "BABYLON.SystemBlock",
                id: 10,
                capacity: 1,
                inputs: [{ name: "emitRate", valueType: "number", value: 10 }, ...inputs],
                ...properties,
            },
        ],
    };
}

async function build(source: unknown) {
    const program = parseNodeParticleSource(source);
    const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);
    return { program, system: set.systems[0]! };
}

function texture(): Texture2D {
    return {
        texture: {} as GPUTexture,
        view: {} as GPUTextureView,
        sampler: {} as GPUSampler,
        width: 1,
        height: 1,
    };
}

describe("NPE SystemBlock render properties", () => {
    it("preserves the wrapped primary binding renderable in MultiplyAdd mode", () => {
        const system = createParticleSystem(1);
        system.texture = texture();
        const billboard = createParticleBillboard(system);
        const properties = { translationPivot: { x: 0, y: 0 }, textureMask: { r: 1, g: 1, b: 1, a: 1 }, renderingGroupId: 0 };
        const scene = { _disposables: [], _pickSources: [], _deferredBuilders: [] } as unknown as SceneContext;
        addFacingBillboardSystemWithParticleRenderProperties(scene, billboard, 4, properties);
        const engine = {
            _device: {
                createBuffer: vi.fn(() => ({ destroy: vi.fn() })),
                createShaderModule: vi.fn(() => ({})),
                createBindGroupLayout: vi.fn(() => ({})),
                createPipelineLayout: vi.fn(() => ({})),
                createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
                createBindGroup: vi.fn(() => ({})),
                queue: { writeBuffer: vi.fn() },
            },
        } as unknown as EngineContext;
        const view = { _worldCenter: [0, 0, -1e9] } as Renderable;
        const primaryBind = vi.fn(() => ({ renderable: view, pipeline: {} as GPURenderPipeline, draw: () => 1 }));
        const renderable = { order: 200, isTransparent: true, bind: primaryBind } satisfies Renderable;
        const built = buildParticleRenderPropertiesBillboardRenderable(engine, billboard, properties, () => ({ renderable, dispose: vi.fn() }));

        const binding = built.renderable.bind(engine, { _colorFormat: "bgra8unorm", _depthStencilFormat: "depth32float", _sampleCount: 1 });

        expect(primaryBind).toHaveBeenCalledOnce();
        expect(binding.renderable).toBe(view);
        expect(binding.renderable).not.toBe(built.renderable);
        built.dispose();
    });

    it.each([
        { name: "empty mask", input: { name: "textureMask", valueType: "BABYLON.Color4", value: [] }, properties: {}, direct: false, dynamic: true },
        { name: "short white mask", input: { name: "textureMask", valueType: "BABYLON.Color4", value: [1, 1, 1] }, properties: {}, direct: false, dynamic: false },
        { name: "extra mask component", input: { name: "textureMask", valueType: "BABYLON.Color4", value: [1, 1, 1, 1, 0] }, properties: {}, direct: false, dynamic: false },
        { name: "partial nonwhite mask", input: { name: "textureMask", valueType: "BABYLON.Color4", value: [0.5] }, properties: {}, direct: true, dynamic: true },
        {
            name: "mistyped group",
            input: { name: "translationPivot", valueType: "BABYLON.Vector2", value: [0, 0] },
            properties: { renderingGroupId: "2" },
            direct: false,
            dynamic: false,
        },
        { name: "non-finite pivot", input: { name: "translationPivot", valueType: "BABYLON.Vector2", value: [NaN, 0] }, properties: {}, direct: false, dynamic: true },
        { name: "trimmed input name", input: { name: " translationPivot ", valueType: "BABYLON.Vector2", value: [0.25, 0] }, properties: {}, direct: true, dynamic: true },
    ])("preserves routing and selection for $name", async ({ input, properties, direct, dynamic }) => {
        for (const connectedRate of [false, true]) {
            const source = systemSource([input], properties, connectedRate ? [{ customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 17, inputs: [] }] : []) as {
                blocks: Array<{ customType: string; inputs: Array<Record<string, unknown>> }>;
            };
            if (connectedRate) {
                source.blocks.find((block) => block.customType === "BABYLON.SystemBlock")!.inputs[0] = {
                    name: "emitRate",
                    targetBlockId: 1,
                    targetConnectionName: "output",
                };
            }
            const { system } = await build(source);
            expect(typeof system._registerBillboard === "function").toBe(connectedRate ? dynamic : direct);
            if (connectedRate) {
                expect(system._emitRateGetter?.()).toBe(17);
            }
        }
    });

    it("keeps missing and serialized-default properties on the default path", async () => {
        const missing = await build(systemSource([]));
        const explicit = await build(
            systemSource(
                [
                    { name: "translationPivot", valueType: "BABYLON.Vector2", value: [0, 0] },
                    { name: "textureMask", valueType: "BABYLON.Color4", value: [1, 1, 1, 1] },
                ],
                { renderingGroupId: 0 }
            )
        );

        expect(missing.system._registerBillboard).toBeUndefined();
        expect(explicit.system._registerBillboard).toBeUndefined();
    });

    it.each([
        ["translationPivot", systemSource([{ name: "translationPivot", valueType: "BABYLON.Vector2", value: [0.25, -0.5] }])],
        ["textureMask", systemSource([{ name: "textureMask", valueType: "BABYLON.Color4", value: [0.5, 1, 0.25, 0.75] }])],
        ["renderingGroupId", systemSource([], { renderingGroupId: 2 })],
        [
            "connected translationPivot",
            systemSource([{ name: "translationPivot", targetBlockId: 1, targetConnectionName: "output" }], {}, [
                { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0004, value: [0, 0], inputs: [] },
            ]),
        ],
        [
            "connected textureMask",
            systemSource([{ name: "textureMask", targetBlockId: 1, targetConnectionName: "output" }], {}, [
                { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0080, value: [1, 1, 1, 1], inputs: [] },
            ]),
        ],
    ])("loads the optional renderer for %s", async (_name, source) => {
        const { system } = await build(source);
        expect(system._registerBillboard).toBeTypeOf("function");
    });

    it("composes connected emit-rate evaluation with render properties", async () => {
        const source = systemSource([{ name: "emitRate", targetBlockId: 1, targetConnectionName: "output" }], { renderingGroupId: 1 }, [
            { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 17, inputs: [] },
        ]) as { blocks: Array<{ customType: string; inputs: Array<Record<string, unknown>> }> };
        source.blocks.find((block) => block.customType === "BABYLON.SystemBlock")!.inputs.shift();

        const { system } = await build(source);

        expect(system._emitRateGetter?.()).toBe(17);
        expect(system._registerBillboard).toBeTypeOf("function");
    });

    it("evaluates and snapshots scratch-backed pivot and mask values once", () => {
        const system = createParticleSystem(1);
        const scratch = { x: 0.25, y: -0.5, r: 0.2, g: 0.4, b: 0.6, a: 0.8 };
        const pivotGetter = vi.fn(() => scratch);
        const maskGetter = vi.fn(() => scratch);
        const block = { id: 1, customType: "BABYLON.SystemBlock", inputs: [] } as ParsedParticleBlock;
        const ctx = {
            state: { system },
            input(_block: ParsedParticleBlock, name: string, fallback?: () => unknown) {
                return name === "translationPivot" ? pivotGetter : name === "textureMask" ? maskGetter : fallback!;
            },
            isConnected() {
                return false;
            },
        } as unknown as NpeBuildContext;

        loadRenderPropertiesBlockEvaluator("SystemBlock").build(block, ctx);
        Object.assign(scratch, { x: 9, y: 9, r: 9, g: 9, b: 9, a: 9 });
        system.texture = texture();
        const billboard = createParticleBillboard(system);
        const scene = { _disposables: [], _pickSources: [], _deferredBuilders: [] } as unknown as SceneContext;
        system._registerBillboard!(scene, billboard);

        const writeBuffer = vi.fn();
        const buffer = { destroy: vi.fn() } as unknown as GPUBuffer;
        const engine = { _device: { createBuffer: vi.fn(() => buffer), queue: { writeBuffer } } } as unknown as EngineContext;
        const fx = billboard._customShader!._createLayerFx(engine, "render-properties")!;
        const write = writeBuffer.mock.calls[0]!;
        const values = new Float32Array(write[2] as ArrayBuffer, write[3] as number, PARTICLE_RENDER_PROPERTIES_UBO_BYTES / 4);

        expect(pivotGetter).toHaveBeenCalledOnce();
        expect(maskGetter).toHaveBeenCalledOnce();
        expect(Array.from(values.slice(0, 4))).toEqual([0.25, -0.5, 0, 0]);
        expect(Array.from(values.slice(4))).toEqual([expect.closeTo(0.2), expect.closeTo(0.4), expect.closeTo(0.6), expect.closeTo(0.8)]);
        fx.destroy();
    });

    it("uses Babylon's zero-pivot and white-mask fallbacks for connected null values", () => {
        const system = createParticleSystem(1);
        const block = { id: 1, customType: "BABYLON.SystemBlock", inputs: [] } as ParsedParticleBlock;
        const ctx = {
            state: { system },
            input(_block: ParsedParticleBlock, name: string, fallback?: () => unknown) {
                return name === "translationPivot" || name === "textureMask" ? () => null : fallback!;
            },
            isConnected() {
                return false;
            },
        } as unknown as NpeBuildContext;

        loadRenderPropertiesBlockEvaluator("SystemBlock").build(block, ctx);
        system.texture = texture();
        const billboard = createParticleBillboard(system);
        const scene = { _disposables: [], _pickSources: [], _deferredBuilders: [] } as unknown as SceneContext;
        system._registerBillboard!(scene, billboard);

        const writeBuffer = vi.fn();
        const engine = {
            _device: { createBuffer: vi.fn(() => ({ destroy: vi.fn() }) as unknown as GPUBuffer), queue: { writeBuffer } },
        } as unknown as EngineContext;
        billboard._customShader!._createLayerFx(engine, "render-properties");
        const write = writeBuffer.mock.calls[0]!;
        const values = new Float32Array(write[2] as ArrayBuffer, write[3] as number, PARTICLE_RENDER_PROPERTIES_UBO_BYTES / 4);

        expect(Array.from(values)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    });
});
