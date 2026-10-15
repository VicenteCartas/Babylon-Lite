import { describe, expect, it, vi } from "vitest";

const gpuGlobals = globalThis as unknown as Record<string, unknown>;
gpuGlobals.GPUBufferUsage ??= { VERTEX: 32, INDEX: 16, UNIFORM: 64, COPY_DST: 8, MAP_WRITE: 1 };
gpuGlobals.GPUShaderStage ??= { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };
gpuGlobals.GPUColorWrite ??= { ALL: 0xf };

import type { Camera } from "../../../packages/babylon-lite/src/camera/camera";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { Mat4 } from "../../../packages/babylon-lite/src/math/types";
import { buildNodeParticleSet } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { compileNodeParticleGraph } from "../../../packages/babylon-lite/src/particle/node/npe-compiler";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import { createParticleBillboard } from "../../../packages/babylon-lite/src/particle/particle-billboard";
import {
    buildParticleBillboardModeRenderable,
    installParticleBillboardMode,
    makeParticleBillboardModeVertexWgsl,
    packParticleBillboardModeInstances,
    particleBillboardModeInstanceFloats,
    particleBillboardModeVertexLayout,
} from "../../../packages/babylon-lite/src/particle/particle-billboard-modes";
import type { ParticleBillboardModeSystem } from "../../../packages/babylon-lite/src/particle/particle-billboard-modes";
import { createPickContributor } from "../../../packages/babylon-lite/src/particle/particle-billboard-modes-pick";
import type { ParticleRenderProperties } from "../../../packages/babylon-lite/src/particle/particle-billboard-render-properties";
import { createParticleBlend } from "../../../packages/babylon-lite/src/particle/particle-blend";
import { createParticleSystem } from "../../../packages/babylon-lite/src/particle/particle-system";
import type { PickingInfo } from "../../../packages/babylon-lite/src/picking/picking-info";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";
import { addBillboardSpriteIndex, createFacingBillboardSystem } from "../../../packages/babylon-lite/src/sprite/billboard-sprite";
import type { SpriteAtlas } from "../../../packages/babylon-lite/src/sprite/shared/sprite-atlas";
import type { Texture2D } from "../../../packages/babylon-lite/src/texture/texture-2d";

const PROPERTIES: ParticleRenderProperties = {
    translationPivot: { x: 0.25, y: -0.5 },
    textureMask: { r: 0.2, g: 0.4, b: 0.6, a: 0.8 },
    renderingGroupId: 2,
};

function identityStorage(): Float64Array {
    const matrix = new Float64Array(16);
    matrix[0] = 1;
    matrix[5] = 1;
    matrix[10] = 1;
    matrix[15] = 1;
    return matrix;
}

function identity(): Mat4 {
    return identityStorage() as unknown as Mat4;
}

function texture(): Texture2D {
    return { texture: {} as GPUTexture, view: {} as GPUTextureView, sampler: {} as GPUSampler, width: 8, height: 8 };
}

function atlas(): SpriteAtlas {
    return {
        texture: texture(),
        textureSizePx: [8, 8],
        frames: [{ uvMin: [0, 0], uvMax: [1, 1], sourceSizePx: [8, 8], pivot: [0.5, 0.5] }],
        premultipliedAlpha: false,
    };
}

function scene(): SceneContext {
    return { _pickSources: [], _deferredBuilders: [], _disposables: [] } as unknown as SceneContext;
}

function camera(useFloatingOrigin = false): Camera {
    const worldMatrix = identityStorage();
    worldMatrix[12] = 11;
    worldMatrix[13] = 12;
    worldMatrix[14] = 13;
    return {
        fov: Math.PI / 4,
        nearPlane: 0.1,
        farPlane: 100,
        children: [],
        worldMatrix: worldMatrix as unknown as Mat4,
        worldMatrixVersion: 3,
        _useFloatingOrigin: useFloatingOrigin,
        _viewCache: identityStorage(),
        _projCache: identityStorage(),
        _vpCache: identityStorage(),
    } as unknown as Camera;
}

function engine(): EngineContext {
    const device = {
        createBuffer: vi.fn((descriptor: GPUBufferDescriptor) => {
            const mapped = new ArrayBuffer(Number(descriptor.size));
            return { destroy: vi.fn(), getMappedRange: vi.fn(() => mapped), unmap: vi.fn() };
        }),
        createShaderModule: vi.fn((descriptor: GPUShaderModuleDescriptor) => ({ descriptor })),
        createBindGroupLayout: vi.fn(() => ({})),
        createPipelineLayout: vi.fn(() => ({})),
        createRenderPipeline: vi.fn(() => ({ getBindGroupLayout: vi.fn(() => ({})) })),
        createBindGroup: vi.fn(() => ({})),
        queue: { writeBuffer: vi.fn() },
    } as unknown as GPUDevice;
    return {
        canvas: { width: 800, height: 600 } as HTMLCanvasElement,
        msaaSamples: 4,
        drawCallCount: 0,
        maxDevicePixelRatio: Infinity,
        useHighPrecisionMatrix: false,
        useFloatingOrigin: false,
        _device: device,
        _context: {} as GPUCanvasContext,
        format: "bgra8unorm",
        _alphaMode: "opaque",
        _animFrameId: 0,
        _renderFn: null,
        _renderingContexts: [],
        _currentEncoder: {} as GPUCommandEncoder,
        _currentDelta: 0,
        _cbs: [],
    } as unknown as EngineContext;
}

function source(properties: Record<string, unknown> = {}, inputs: Array<Record<string, unknown>> = [], blocks: Array<Record<string, unknown>> = []): unknown {
    const systemInputs = inputs.some((input) => input.name === "emitRate") ? inputs : [{ name: "emitRate", valueType: "number", value: 10 }, ...inputs];
    return { blocks: [...blocks, { customType: "BABYLON.SystemBlock", id: 10, capacity: 2, inputs: systemInputs, ...properties }] };
}

async function build(graph: unknown) {
    const program = await compileNodeParticleGraph(parseNodeParticleSource(graph));
    const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);
    return { program, system: set.systems[0]! };
}

function modeSystem(mode: 0 | 2 | 8 | 9, directions: Float32Array | null = null): ParticleBillboardModeSystem {
    const billboard = createFacingBillboardSystem(atlas(), { capacity: 2 });
    addBillboardSpriteIndex(billboard, { position: [1, 2, 3], sizeWorld: [2, 4], color: [0.1, 0.2, 0.3, 0.4], rotation: 0.5 });
    (billboard as unknown as { _particleBillboardMode: 0 | 2 | 8 | 9 })._particleBillboardMode = mode;
    (billboard as unknown as { _particleDirections: Float32Array | null })._particleDirections = directions;
    return billboard as ParticleBillboardModeSystem;
}

describe("NPE SystemBlock billboard modes", () => {
    it("keeps missing and explicit ALL geometry on the default path", async () => {
        const missing = await build(source());
        const explicit = await build(source({ isBillboardBased: true, billBoardMode: 7 }));

        expect(missing.system._syncBillboard).toBeUndefined();
        expect(explicit.system._syncBillboard).toBeUndefined();
    });

    it.each([
        ["Y", { isBillboardBased: true, billBoardMode: 2 }],
        ["STRETCHED", { isBillboardBased: true, billBoardMode: 8 }],
        ["STRETCHED_LOCAL", { isBillboardBased: true, billBoardMode: 9 }],
        ["non-billboard", { isBillboardBased: false, billBoardMode: 123 }],
    ])("routes %s through the lazy mode attachment", async (_name, properties) => {
        const { system } = await build(source(properties));
        expect(system._syncBillboard).toBeTypeOf("function");
        expect(system._registerBillboard).toBeTypeOf("function");
    });

    it("rejects unsupported true-billboard values", async () => {
        await expect(build(source({ isBillboardBased: true, billBoardMode: 5 }))).rejects.toThrow("NodeParticle: unsupported billboard mode 5");
    });

    it("composes mode-first routing with connected emit rate and Phase 10 properties", async () => {
        const { system } = await build(
            source(
                { isBillboardBased: true, billBoardMode: 2, renderingGroupId: 3 },
                [
                    { name: "emitRate", targetBlockId: 1, targetConnectionName: "output" },
                    { name: "translationPivot", valueType: "BABYLON.Vector2", value: [0.25, -0.5] },
                    { name: "textureMask", valueType: "BABYLON.Color4", value: [0.2, 0.4, 0.6, 0.8] },
                ],
                [{ customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 17, inputs: [] }]
            )
        );
        system.texture = texture();
        const billboard = createParticleBillboard(system);
        const targetScene = scene();
        system._registerBillboard!(targetScene, billboard);

        expect(system._emitRateGetter?.()).toBe(17);
        expect(targetScene._pickSources[0]!.entity).toMatchObject({
            system: billboard,
            properties: {
                translationPivot: { x: 0.25, y: -0.5 },
                textureMask: { r: 0.2, g: 0.4, b: 0.6, a: 0.8 },
                renderingGroupId: 3,
            },
        });
    });
});

describe("particle billboard mode direction storage", () => {
    it("captures non-billboard direction before emit power and transforms local initial direction", () => {
        const system = createParticleSystem(1);
        system.texture = texture();
        system.createEmitPower = (index) => {
            system.buffer.dirX[index] = system.buffer.dirX[index]! * 4;
            system.buffer.dirY[index] = system.buffer.dirY[index]! * 4;
            system.buffer.dirZ[index] = system.buffer.dirZ[index]! * 4;
        };
        const emitterStorage = identityStorage();
        const emitter = emitterStorage as unknown as Mat4;
        emitterStorage[0] = 0;
        emitterStorage[1] = 1;
        emitterStorage[4] = -1;
        emitterStorage[5] = 0;
        installParticleBillboardMode(system, 0, PROPERTIES, true, emitter);
        system.buffer.dirX[0] = 1;
        system.buffer.dirY[0] = 0;
        system.buffer.dirZ[0] = 1;
        system.createEmitPower!(0);
        system.buffer.alive = 1;
        system.buffer.size[0] = system.buffer.scaleX[0] = system.buffer.scaleY[0] = 1;

        const billboard = createParticleBillboard(system);
        system._syncBillboard!(system, billboard);
        system._registerBillboard!(scene(), billboard);
        const specialized = billboard as ParticleBillboardModeSystem;

        expect(system.buffer._columns.get("initialDir.x")?.[0]).toBe(1);
        expect(system.buffer.dirX[0]).toBe(4);
        expect(Array.from(specialized._particleDirections!)).toEqual([0, 1, 1]);
    });

    it("uses current direction for stretched modes and mesh-normal non-billboard fallback", () => {
        const stretched = createParticleSystem(1);
        stretched.texture = texture();
        installParticleBillboardMode(stretched, 8, PROPERTIES, false, identity());
        stretched.buffer.alive = 1;
        stretched.buffer.dirX[0] = 2;
        stretched.buffer.dirY[0] = 3;
        stretched.buffer.dirZ[0] = 4;
        const stretchedBillboard = createParticleBillboard(stretched);
        stretched._syncBillboard!(stretched, stretchedBillboard);
        stretched._registerBillboard!(scene(), stretchedBillboard);
        expect(Array.from((stretchedBillboard as ParticleBillboardModeSystem)._particleDirections!)).toEqual([2, 3, 4]);

        const mesh = createParticleSystem(1);
        mesh.texture = texture();
        mesh._suppressInitialDirectionCapture = true;
        installParticleBillboardMode(mesh, 0, PROPERTIES, false, identity());
        mesh.buffer.alive = 1;
        mesh.buffer.dirX[0] = 5;
        mesh.buffer.dirY[0] = 6;
        mesh.buffer.dirZ[0] = 7;
        const meshBillboard = createParticleBillboard(mesh);
        mesh._syncBillboard!(mesh, meshBillboard);
        mesh._registerBillboard!(scene(), meshBillboard);

        expect(mesh.buffer._columns.has("initialDir.x")).toBe(false);
        expect(Array.from((meshBillboard as ParticleBillboardModeSystem)._particleDirections!)).toEqual([5, 6, 7]);
    });
});

describe("particle billboard mode GPU contracts", () => {
    it("uses 64-byte Y and 76-byte direction layouts with exact mode equations", () => {
        expect(particleBillboardModeInstanceFloats(2)).toBe(16);
        expect(particleBillboardModeVertexLayout(2, false).arrayStride).toBe(64);
        expect(particleBillboardModeInstanceFloats(8)).toBe(19);
        expect(particleBillboardModeVertexLayout(8, false).arrayStride).toBe(76);
        expect(particleBillboardModeVertexLayout(8, false).attributes).toContainEqual({ shaderLocation: 7, offset: 64, format: "float32x3" });

        const y = makeParticleBillboardModeVertexWgsl(2, false);
        expect(y).toContain("let eyePosition = scene.vEyePosition.xyz");
        expect(y).toContain("vec3f(in.p.x - eyePosition.x, 0, in.p.z - eyePosition.z)");
        expect(y).toContain("cross(vec3f(0, 1, 0), toParticle)");
        const stretched = makeParticleBillboardModeVertexWgsl(8, false);
        expect(stretched).toContain("cross(normalize(in.d), toCamera)");
        expect(stretched).toContain("cross(toCamera, right)");
        const local = makeParticleBillboardModeVertexWgsl(9, false);
        expect(local).toContain("let up = normalize(in.d)");
        const nonBillboard = makeParticleBillboardModeVertexWgsl(0, false);
        expect(nonBillboard).toContain("let axis = normalize(in.d)");
        expect(nonBillboard).toContain("cross(axis, right)");
        const pick = makeParticleBillboardModeVertexWgsl(8, true);
        expect(pick).toContain("properties.eye");
        expect(pick).not.toContain("scene.vEyePosition");
        expect(pick).toContain("properties.baseId + in.iid");
    });

    it("packs sorted direction sidecars and always reads authoritative F64 anchors", () => {
        const system = modeSystem(8, new Float32Array([1, 2, 3, 4, 5, 6]));
        addBillboardSpriteIndex(system, { position: [7, 8, 9], sizeWorld: [1, 1] });
        system._instanceData[0] = 99;
        const target = new Float32Array(2 * 19);

        packParticleBillboardModeInstances(system, target, new Uint32Array([1, 0]));

        expect(Array.from(target.slice(0, 3))).toEqual([7, 8, 9]);
        expect(Array.from(target.slice(16, 19))).toEqual([4, 5, 6]);
        expect(Array.from(target.slice(19, 22))).toEqual([1, 2, 3]);
        expect(Array.from(target.slice(35, 38))).toEqual([1, 2, 3]);
    });

    it("preserves mask, translated pivot, rendering group, and ordered MultiplyAdd passes", () => {
        const targetEngine = engine();
        const system = modeSystem(8, new Float32Array([0, 1, 0, 0, 0, 0]));
        (system as { blendMode: ReturnType<typeof createParticleBlend> }).blendMode = createParticleBlend(4);
        const built = buildParticleBillboardModeRenderable(targetEngine, system, PROPERTIES);
        const binding = built.renderable.bind(targetEngine, { _colorFormat: "bgra8unorm", _depthStencilFormat: "depth32float", _sampleCount: 1 });
        const device = targetEngine._device as unknown as {
            createRenderPipeline: ReturnType<typeof vi.fn>;
            createShaderModule: ReturnType<typeof vi.fn>;
            queue: { writeBuffer: ReturnType<typeof vi.fn> };
        };

        expect(device.createRenderPipeline).toHaveBeenCalledTimes(2);
        const shader = (device.createShaderModule.mock.calls[0]![0] as GPUShaderModuleDescriptor).code;
        expect(shader).toContain("(sampled * properties.textureMask + (vec4f(1.0) - properties.textureMask))");
        expect(shader).toContain("let l = (q - in.o - properties.translationPivot) * in.s");
        expect(shader).toContain("+ properties.translationPivot");
        const propertyWrites = device.queue.writeBuffer.mock.calls.filter((call) => call[4] === undefined && (call[2] as Float32Array).byteLength === 32);
        expect(Array.from(propertyWrites[0]![2] as Float32Array)).toEqual([0.25, -0.5, 1, 0, expect.closeTo(0.2), expect.closeTo(0.4), expect.closeTo(0.6), expect.closeTo(0.8)]);
        expect(Array.from(propertyWrites[1]![2] as Float32Array)).toEqual([0.25, -0.5, 0, 0, expect.closeTo(0.2), expect.closeTo(0.4), expect.closeTo(0.6), expect.closeTo(0.8)]);

        binding.update?.({ _camera: camera() } as never);
        const pass = {
            setPipeline: vi.fn(),
            setBindGroup: vi.fn(),
            setIndexBuffer: vi.fn(),
            setVertexBuffer: vi.fn(),
            drawIndexed: vi.fn(),
        } as unknown as GPURenderPassEncoder;
        expect(binding.draw(pass, targetEngine)).toBe(2);
        expect(pass.drawIndexed).toHaveBeenCalledTimes(2);
        built.dispose();
    });

    it("allocates picking resources lazily and resolves the original system and logical index", () => {
        const targetEngine = engine();
        targetEngine.useFloatingOrigin = true;
        const system = modeSystem(9, new Float32Array([0, 1, 0, 0, 0, 0]));
        const source = { system, properties: PROPERTIES };
        const contributor = createPickContributor(source);
        const device = targetEngine._device as unknown as {
            createBuffer: ReturnType<typeof vi.fn>;
            createShaderModule: ReturnType<typeof vi.fn>;
            queue: { writeBuffer: ReturnType<typeof vi.fn> };
        };

        expect(device.createBuffer).not.toHaveBeenCalled();
        const pass = {
            setBindGroup: vi.fn(),
            setPipeline: vi.fn(),
            setIndexBuffer: vi.fn(),
            setVertexBuffer: vi.fn(),
            drawIndexed: vi.fn(),
        } as unknown as GPURenderPassEncoder;
        const nextId = contributor.draw({ engine: targetEngine, camera: camera(true), detailed: false, pass, sceneBG: {} as GPUBindGroup } as never, 40);
        expect(nextId).toBe(41);
        expect(device.createBuffer).toHaveBeenCalled();
        const shader = (device.createShaderModule.mock.calls[0]![0] as GPUShaderModuleDescriptor).code;
        expect(shader).toContain("let up = normalize(in.d)");
        expect(shader).toContain("properties.baseId + in.iid");
        const instanceWrite = device.queue.writeBuffer.mock.calls.find((call) => call[4] === 76)!;
        const instance = new Float32Array(instanceWrite[2] as ArrayBuffer, instanceWrite[3] as number, 19);
        expect(Array.from(instance.slice(0, 3))).toEqual([-10, -10, -10]);
        const uboWrite = device.queue.writeBuffer.mock.calls.find((call) => call[4] === 32)!;
        const ubo = new Float32Array(uboWrite[2] as ArrayBuffer, uboWrite[3] as number, 8);
        expect(Array.from(ubo.slice(4, 7))).toEqual([0, 0, 0]);

        const info = {} as PickingInfo;
        contributor.resolve(info, 0);
        expect(info._spritePick).toMatchObject({ system, spriteIndex: 0 });
        contributor.dispose?.();
    });
});
