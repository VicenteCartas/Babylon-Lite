import { BU, CW, SS } from "../engine/gpu-flags.js";
import type { EngineContext } from "../engine/engine.js";
import { F32, U32 } from "../engine/typed-arrays.js";
import { getPickingSceneBGL } from "../picking/picking-scene-bgl.js";
import type { PickContributor } from "../picking/pick-contributor.js";
import {
    makeParticleBillboardModeVertexWgsl,
    packParticleBillboardModeInstances,
    particleBillboardModeInstanceFloats,
    particleBillboardModeVertexLayout,
} from "./particle-billboard-modes.js";
import type { ParticleBillboardMode, ParticleBillboardModePickSource } from "./particle-billboard-modes.js";

const PICK_UBO_BYTES = 32;

interface PickDeviceCache {
    readonly pipelines: Map<string, GPURenderPipeline>;
    readonly layouts: Map<boolean, GPUBindGroupLayout>;
}

interface PickResources {
    readonly ubo: GPUBuffer;
    readonly uboData: ArrayBuffer;
    readonly uboF32: Float32Array;
    readonly uboU32: Uint32Array;
    instanceBuffer: GPUBuffer;
    instanceCapacity: number;
    staging: Float32Array;
    readonly indexBuffer: GPUBuffer;
    readonly bindGroups: Map<boolean, GPUBindGroup>;
}

let _deviceCaches: WeakMap<GPUDevice, PickDeviceCache> | null = null;

function getCache(device: GPUDevice): PickDeviceCache {
    _deviceCaches ??= new WeakMap();
    let cache = _deviceCaches.get(device);
    if (!cache) {
        cache = { pipelines: new Map(), layouts: new Map() };
        _deviceCaches.set(device, cache);
    }
    return cache;
}

function makePickWgsl(mode: ParticleBillboardMode, detailed: boolean): string {
    return `struct PickScene { viewProjection: mat4x4f };
@group(0) @binding(0) var<uniform> scene: PickScene;
struct P {
translationPivot: vec2f,
baseId: u32,
_padding: f32,
eye: vec3f,
_padding2: f32,
};
@group(1) @binding(0) var<uniform> properties: P;
struct O {
@builtin(position) p: vec4f,
@location(0) @interpolate(flat) pickId: u32,
};
${makeParticleBillboardModeVertexWgsl(mode, true)}
struct FsOut { @location(0) color: vec4f, @location(1) depth: f32${detailed ? ", @location(2) detail: vec4u" : ""} };
@fragment
fn fs(in: O) -> FsOut {
let id = in.pickId;
let r = f32((id >> 16u) & 0xFFu) / 255.0;
let g = f32((id >> 8u) & 0xFFu) / 255.0;
let b = f32(id & 0xFFu) / 255.0;
return FsOut(vec4f(r, g, b, 1.0), in.p.z${detailed ? ", vec4u(0xffffffffu, 0u, 0u, 0u)" : ""});
}`;
}

function getLayout(engine: EngineContext, detailed: boolean): GPUBindGroupLayout {
    const cache = getCache(engine._device);
    let layout = cache.layouts.get(detailed);
    if (!layout) {
        layout = engine._device.createBindGroupLayout({
            label: "particle-billboard-mode-pick-bgl",
            entries: [{ binding: 0, visibility: SS.VERTEX, buffer: { type: "uniform" } }],
        });
        cache.layouts.set(detailed, layout);
    }
    return layout;
}

function getPipeline(engine: EngineContext, mode: ParticleBillboardMode, detailed: boolean): GPURenderPipeline {
    const cache = getCache(engine._device);
    const key = `${mode}:${detailed ? "d" : "b"}`;
    let pipeline = cache.pipelines.get(key);
    if (pipeline) {
        return pipeline;
    }
    const module = engine._device.createShaderModule({ label: "particle-billboard-mode-pick", code: makePickWgsl(mode, detailed) });
    pipeline = engine._device.createRenderPipeline({
        label: "particle-billboard-mode-pick-pipeline",
        layout: engine._device.createPipelineLayout({ bindGroupLayouts: [getPickingSceneBGL(engine), getLayout(engine, detailed)] }),
        vertex: { module, entryPoint: "vs", buffers: [particleBillboardModeVertexLayout(mode, true)] },
        fragment: {
            module,
            entryPoint: "fs",
            targets: detailed
                ? [{ format: "rgba8unorm", writeMask: CW.ALL }, { format: "r32float" }, { format: "rgba32uint" }]
                : [{ format: "rgba8unorm", writeMask: CW.ALL }, { format: "r32float" }],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: "depth24plus", depthCompare: "greater", depthWriteEnabled: true },
        multisample: { count: 1 },
    });
    cache.pipelines.set(key, pipeline);
    return pipeline;
}

function createResources(engine: EngineContext, source: ParticleBillboardModePickSource, indexData: Uint16Array): PickResources {
    const system = source.system;
    const strideFloats = particleBillboardModeInstanceFloats(system._particleBillboardMode);
    const instanceCapacity = Math.max(1, system._capacity);
    const ubo = engine._device.createBuffer({ label: "particle-billboard-mode-pick-ubo", size: PICK_UBO_BYTES, usage: BU.UNIFORM | BU.COPY_DST });
    const uboData = new ArrayBuffer(PICK_UBO_BYTES);
    const indexBuffer = engine._device.createBuffer({ label: "particle-billboard-mode-pick-indices", size: indexData.byteLength, usage: BU.INDEX | BU.COPY_DST });
    engine._device.queue.writeBuffer(indexBuffer, 0, indexData);
    return {
        ubo,
        uboData,
        uboF32: new F32(uboData),
        uboU32: new U32(uboData),
        instanceBuffer: engine._device.createBuffer({
            label: "particle-billboard-mode-pick-instances",
            size: instanceCapacity * strideFloats * 4,
            usage: BU.VERTEX | BU.COPY_DST,
        }),
        instanceCapacity,
        staging: new F32(instanceCapacity * strideFloats),
        indexBuffer,
        bindGroups: new Map(),
    };
}

function disposeResources(resources: PickResources): void {
    resources.ubo.destroy();
    resources.instanceBuffer.destroy();
    resources.indexBuffer.destroy();
    resources.bindGroups.clear();
}

/** Build the lazy exact picker for one serialized particle billboard mode. */
export function createPickContributor(source: ParticleBillboardModePickSource, indexData: Uint16Array): PickContributor {
    const system = source.system;
    let resources: PickResources | null = null;
    return {
        draw(ctx, baseId) {
            const count = system.count;
            if (!system.visible || count === 0) {
                return baseId + count;
            }
            resources ??= createResources(ctx.engine, source, indexData);
            const strideFloats = particleBillboardModeInstanceFloats(system._particleBillboardMode);
            if (system._capacity > resources.instanceCapacity) {
                resources.instanceBuffer.destroy();
                resources.instanceCapacity = system._capacity;
                resources.instanceBuffer = ctx.engine._device.createBuffer({
                    label: "particle-billboard-mode-pick-instances",
                    size: resources.instanceCapacity * strideFloats * 4,
                    usage: BU.VERTEX | BU.COPY_DST,
                });
                resources.staging = new F32(resources.instanceCapacity * strideFloats);
            }
            const cameraWorld = ctx.camera.worldMatrix;
            const useFloatingOrigin = ctx.camera._useFloatingOrigin === true;
            const eyeX = cameraWorld[12]!;
            const eyeY = cameraWorld[13]!;
            const eyeZ = cameraWorld[14]!;
            packParticleBillboardModeInstances(system, resources.staging, undefined, useFloatingOrigin ? eyeX : 0, useFloatingOrigin ? eyeY : 0, useFloatingOrigin ? eyeZ : 0);
            ctx.engine._device.queue.writeBuffer(resources.instanceBuffer, 0, resources.staging.buffer, resources.staging.byteOffset, count * strideFloats * 4);

            resources.uboF32[0] = source.properties.translationPivot.x;
            resources.uboF32[1] = source.properties.translationPivot.y;
            resources.uboU32[2] = baseId;
            resources.uboF32[4] = useFloatingOrigin ? 0 : eyeX;
            resources.uboF32[5] = useFloatingOrigin ? 0 : eyeY;
            resources.uboF32[6] = useFloatingOrigin ? 0 : eyeZ;
            ctx.engine._device.queue.writeBuffer(resources.ubo, 0, resources.uboData, 0, PICK_UBO_BYTES);

            const pipeline = getPipeline(ctx.engine, system._particleBillboardMode, ctx.detailed);
            let bindGroup = resources.bindGroups.get(ctx.detailed);
            if (!bindGroup) {
                bindGroup = ctx.engine._device.createBindGroup({
                    label: "particle-billboard-mode-pick-bg",
                    layout: pipeline.getBindGroupLayout(1),
                    entries: [{ binding: 0, resource: { buffer: resources.ubo } }],
                });
                resources.bindGroups.set(ctx.detailed, bindGroup);
            }
            ctx.pass.setBindGroup(0, ctx.sceneBG);
            ctx.pass.setPipeline(pipeline);
            ctx.pass.setBindGroup(1, bindGroup);
            ctx.pass.setIndexBuffer(resources.indexBuffer, "uint16");
            ctx.pass.setVertexBuffer(0, resources.instanceBuffer);
            ctx.pass.drawIndexed(6, count);
            return baseId + count;
        },
        resolve(info, localId) {
            info._spritePick = { system, spriteIndex: localId, pickedPoint: info.pickedPoint, distance: info.distance };
        },
        dispose() {
            if (resources) {
                disposeResources(resources);
                resources = null;
            }
        },
    };
}
