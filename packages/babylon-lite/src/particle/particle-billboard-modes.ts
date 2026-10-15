import type { Camera } from "../camera/camera.js";
import { BU, CW, SS } from "../engine/gpu-flags.js";
import type { EngineContext } from "../engine/engine.js";
import type { RenderTargetSignature } from "../engine/render-target.js";
import { F32 } from "../engine/typed-arrays.js";
import type { Mat4 } from "../math/types.js";
import { applyParticleRenderingGroup } from "./particle-rendering-group.js";
import { addParticleSceneRenderable } from "./particle-scene-renderable.js";
import type { DrawBinding, DrawUpdateContext, Renderable } from "../render/renderable.js";
import { getSceneBindGroupLayout } from "../render/scene-helpers.js";
import { createEmptyUniformBuffer, createMappedBuffer } from "../resource/gpu-buffers.js";
import type { SceneContext } from "../scene/scene-core.js";
import { SCENE_UBO_WGSL } from "../shader/scene-uniforms.js";
import { BILLBOARD_INDEX_DATA, BILLBOARD_SYSTEM_UBO_BYTES, buildBillboardSystemUbo, writeBillboardSystemUboIfDirty } from "../sprite/billboard-pipeline.js";
import type { FacingBillboardSpriteSystem } from "../sprite/billboard-sprite.js";
import { BILLBOARD_INSTANCE_FLOATS_PER_SPRITE } from "../sprite/billboard-sprite.js";
import { column } from "./particle-buffer.js";
import { syncParticleBillboard } from "./particle-billboard.js";
import type { ParticleRenderProperties } from "./particle-billboard-render-properties.js";
import { createParticleBlend } from "./particle-blend.js";
import type { ParticleSystem } from "./particle-system.js";

/** @internal Specialized serialized particle billboard modes. Zero means non-billboard geometry. */
export type ParticleBillboardMode = 0 | 2 | 8 | 9;

/** @internal Billboard state extended only by the lazy particle mode feature. */
export interface ParticleBillboardModeSystem extends FacingBillboardSpriteSystem {
    /** @internal Serialized geometry mode selected by the lazy attachment. */
    readonly _particleBillboardMode: ParticleBillboardMode;
    /** @internal Feature-owned direction sidecar for 76-byte instances. */
    readonly _particleDirections: Float32Array | null;
}

/** @internal Lazy pick source for one specialized particle billboard system. */
export interface ParticleBillboardModePickSource {
    readonly system: ParticleBillboardModeSystem;
    readonly properties: ParticleRenderProperties;
}

const MODE_DIRECTION_FLOATS = 3;
const MODE_PROPERTIES_UBO_BYTES = 32;
const POSITION_OFFSET_BYTES = 0;
const SIZE_OFFSET_BYTES = 12;
const UV_MIN_OFFSET_BYTES = 20;
const UV_MAX_OFFSET_BYTES = 28;
const ROTATION_OFFSET_BYTES = 36;
const PIVOT_OFFSET_BYTES = 40;
const COLOR_OFFSET_BYTES = 48;
const DIRECTION_OFFSET_BYTES = 64;

interface ModeDeviceCache {
    readonly modules: Map<ParticleBillboardMode, GPUShaderModule>;
    readonly pipelines: Map<string, GPURenderPipeline>;
}

let _deviceCaches: WeakMap<GPUDevice, ModeDeviceCache> | null = null;

function usesDirection(mode: ParticleBillboardMode): boolean {
    return mode !== 2;
}

/** @internal Float count of one specialized instance for the selected mode. */
export function particleBillboardModeInstanceFloats(mode: ParticleBillboardMode): number {
    return BILLBOARD_INSTANCE_FLOATS_PER_SPRITE + (usesDirection(mode) ? MODE_DIRECTION_FLOATS : 0);
}

function getInitialDirections(system: ParticleSystem): readonly [Float32Array, Float32Array, Float32Array] | null {
    const buffer = system.buffer;
    const existingX = buffer._columns.get("initialDir.x") as Float32Array | undefined;
    const existingY = buffer._columns.get("initialDir.y") as Float32Array | undefined;
    const existingZ = buffer._columns.get("initialDir.z") as Float32Array | undefined;
    if (existingX && existingY && existingZ) {
        return [existingX, existingY, existingZ];
    }
    if (system._suppressInitialDirectionCapture) {
        return null;
    }

    const x = column(buffer, "initialDir.x", Float32Array);
    const y = column(buffer, "initialDir.y", Float32Array);
    const z = column(buffer, "initialDir.z", Float32Array);
    const previous = system.createEmitPower;
    system.createEmitPower = (index) => {
        x[index] = buffer.dirX[index]!;
        y[index] = buffer.dirY[index]!;
        z[index] = buffer.dirZ[index]!;
        previous?.(index);
    };
    return [x, y, z];
}

function synchronizeDirections(
    system: ParticleSystem,
    directions: Float32Array,
    mode: ParticleBillboardMode,
    initialDirections: readonly [Float32Array, Float32Array, Float32Array] | null,
    isLocal: boolean,
    emitterWorldMatrix: Mat4
): void {
    const buffer = system.buffer;
    const sourceX = initialDirections?.[0] ?? buffer.dirX;
    const sourceY = initialDirections?.[1] ?? buffer.dirY;
    const sourceZ = initialDirections?.[2] ?? buffer.dirZ;
    for (let index = 0; index < buffer.alive; index++) {
        let x = sourceX[index]!;
        let y = sourceY[index]!;
        let z = sourceZ[index]!;
        if (mode === 0 && isLocal) {
            const transformedX = emitterWorldMatrix[0]! * x + emitterWorldMatrix[4]! * y + emitterWorldMatrix[8]! * z;
            const transformedY = emitterWorldMatrix[1]! * x + emitterWorldMatrix[5]! * y + emitterWorldMatrix[9]! * z;
            const transformedZ = emitterWorldMatrix[2]! * x + emitterWorldMatrix[6]! * y + emitterWorldMatrix[10]! * z;
            x = transformedX;
            y = transformedY;
            z = transformedZ;
        }
        if (mode === 0 && x === 0 && z === 0) {
            x = 0.001;
        }
        const offset = index * MODE_DIRECTION_FLOATS;
        directions[offset] = x;
        directions[offset + 1] = y;
        directions[offset + 2] = z;
    }
}

/** Install one serialized particle billboard mode without changing ordinary billboard systems. */
export function installParticleBillboardMode(
    system: ParticleSystem,
    mode: ParticleBillboardMode,
    properties: ParticleRenderProperties,
    isLocal: boolean,
    emitterWorldMatrix: Mat4
): void {
    const directions = usesDirection(mode) ? new F32(system.buffer.capacity * MODE_DIRECTION_FLOATS) : null;
    const initialDirections = mode === 0 ? getInitialDirections(system) : null;
    system._syncBillboard = (particleSystem, billboard) => {
        syncParticleBillboard(particleSystem, billboard);
        if (directions) {
            synchronizeDirections(particleSystem, directions, mode, initialDirections, isLocal, emitterWorldMatrix);
        }
    };
    system._registerBillboard = (scene, billboard) => {
        const modeSystem = billboard as ParticleBillboardModeSystem;
        (modeSystem as { _particleBillboardMode: ParticleBillboardMode })._particleBillboardMode = mode;
        (modeSystem as { _particleDirections: Float32Array | null })._particleDirections = directions;
        return addParticleBillboardModeSystem(scene, modeSystem, system.blendMode, properties);
    };
}

function makeModeBasisWgsl(mode: ParticleBillboardMode, eye: string): string {
    switch (mode) {
        case 2:
            return `let eyePosition = ${eye};
let toParticle = normalize(vec3f(in.p.x - eyePosition.x, 0, in.p.z - eyePosition.z));
let right = normalize(cross(vec3f(0, 1, 0), toParticle));
let up = normalize(cross(toParticle, right));`;
        case 8:
            return `let eyePosition = ${eye};
let toCamera = normalize(in.p - eyePosition);
let right = normalize(cross(normalize(in.d), toCamera));
let up = normalize(cross(toCamera, right));`;
        case 9:
            return `let eyePosition = ${eye};
let toCamera = normalize(in.p - eyePosition);
let right = normalize(cross(normalize(in.d), toCamera));
let up = normalize(in.d);`;
        case 0:
            return `let axis = normalize(in.d);
let right = normalize(cross(vec3f(0, 1, 0), axis));
let up = normalize(cross(axis, right));`;
    }
}

/** @internal Exact specialized vertex body shared with the lazy pick pipeline. */
export function makeParticleBillboardModeVertexWgsl(mode: ParticleBillboardMode, pick: boolean): string {
    const direction = usesDirection(mode) ? "\n@location(7) d: vec3f," : "";
    const pickId = pick ? "\n@builtin(instance_index) iid: u32," : "";
    const renderAttributes = pick
        ? ""
        : `
@location(2) a: vec2f,
@location(3) b: vec2f,
@location(6) c: vec4f,`;
    return `struct I {
@builtin(vertex_index) vid: u32,${pickId}
@location(0) p: vec3f,
@location(1) s: vec2f,
@location(4) r: f32,
@location(5) o: vec2f,${renderAttributes}${direction}
};
@vertex
fn vs(in: I) -> O {
let q = vec2f(select(0.0, 1.0, in.vid == 1u || in.vid == 2u), select(0.0, 1.0, in.vid >= 2u));
let l = ((q - in.o) * vec2f(1, -1) - properties.translationPivot) * in.s;
let cr = cos(in.r);
let sr = -sin(in.r);
let r = vec2f(l.x * cr - l.y * sr, l.x * sr + l.y * cr) + properties.translationPivot;
${makeModeBasisWgsl(mode, pick ? "properties.eye" : "scene.vEyePosition.xyz")}
let wp = in.p + right * r.x + up * r.y;
var out: O;
out.p = scene.viewProjection * vec4f(wp, 1);
${pick ? "out.pickId = properties.baseId + in.iid;" : "out.uv = mix(in.a, in.b, q);\nout.tint = in.c;"}
return out;
}`;
}

function makeModeWgsl(mode: ParticleBillboardMode): string {
    return `${SCENE_UBO_WGSL}
struct S {
opacityMul: vec4f,
axisAndCutoff: vec4f,
};
struct P {
translationPivot: vec2f,
multiplyPass: f32,
_padding: f32,
textureMask: vec4f,
};
@group(1) @binding(0) var<uniform> billboards: S;
@group(1) @binding(1) var atlasTex: texture_2d<f32>;
@group(1) @binding(2) var atlasSamp: sampler;
@group(1) @binding(3) var<uniform> properties: P;
struct O {
@builtin(position) p: vec4f,
@location(0) uv: vec2f,
@location(1) tint: vec4f,
};
${makeParticleBillboardModeVertexWgsl(mode, false)}
@fragment
fn fs(in: O) -> @location(0) vec4f {
let sampled = textureSample(atlasTex, atlasSamp, in.uv);
let baseColor = (sampled * properties.textureMask + (vec4f(1.0) - properties.textureMask)) * in.tint * billboards.opacityMul;
if (properties.multiplyPass > 0.5) {
let sourceAlpha = sampled.a * in.tint.a * billboards.opacityMul.a;
return vec4f(baseColor.rgb * sourceAlpha + vec3f(1.0) * (1.0 - sourceAlpha), baseColor.a);
}
return baseColor;
}`;
}

function getDeviceCache(device: GPUDevice): ModeDeviceCache {
    _deviceCaches ??= new WeakMap();
    let cache = _deviceCaches.get(device);
    if (!cache) {
        cache = { modules: new Map(), pipelines: new Map() };
        _deviceCaches.set(device, cache);
    }
    return cache;
}

function getShaderModule(engine: EngineContext, mode: ParticleBillboardMode): GPUShaderModule {
    const cache = getDeviceCache(engine._device);
    let module = cache.modules.get(mode);
    if (!module) {
        module = engine._device.createShaderModule({ code: makeModeWgsl(mode) });
        cache.modules.set(mode, module);
    }
    return module;
}

/** @internal Vertex-buffer layout shared by render and pick pipelines. */
export function particleBillboardModeVertexLayout(mode: ParticleBillboardMode, pick: boolean): GPUVertexBufferLayout {
    const attributes: GPUVertexAttribute[] = [
        { shaderLocation: 0, offset: POSITION_OFFSET_BYTES, format: "float32x3" },
        { shaderLocation: 1, offset: SIZE_OFFSET_BYTES, format: "float32x2" },
        { shaderLocation: 4, offset: ROTATION_OFFSET_BYTES, format: "float32" },
        { shaderLocation: 5, offset: PIVOT_OFFSET_BYTES, format: "float32x2" },
    ];
    if (!pick) {
        attributes.splice(2, 0, { shaderLocation: 2, offset: UV_MIN_OFFSET_BYTES, format: "float32x2" }, { shaderLocation: 3, offset: UV_MAX_OFFSET_BYTES, format: "float32x2" });
        attributes.push({ shaderLocation: 6, offset: COLOR_OFFSET_BYTES, format: "float32x4" });
    }
    if (usesDirection(mode)) {
        attributes.push({ shaderLocation: 7, offset: DIRECTION_OFFSET_BYTES, format: "float32x3" });
    }
    return { arrayStride: particleBillboardModeInstanceFloats(mode) * 4, stepMode: "instance", attributes };
}

function getPipeline(
    engine: EngineContext,
    target: RenderTargetSignature,
    system: ParticleBillboardModeSystem,
    blendMode: FacingBillboardSpriteSystem["blendMode"]
): GPURenderPipeline {
    if (!target._depthStencilFormat) {
        throw new Error("BillboardSpriteSystem requires a depth-stencil render target.");
    }
    const sampleCount = target._sampleCount === 1 ? 1 : 4;
    const cache = getDeviceCache(engine._device);
    const key = `${target._colorFormat}:${sampleCount}:${system._particleBillboardMode}:${blendMode._key}:${target._depthStencilFormat}`;
    let pipeline = cache.pipelines.get(key);
    if (pipeline) {
        return pipeline;
    }
    const device = engine._device;
    const layout = device.createBindGroupLayout({
        entries: [
            { binding: 0, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: "uniform" } },
            { binding: 1, visibility: SS.FRAGMENT, texture: { sampleType: "float" } },
            { binding: 2, visibility: SS.FRAGMENT, sampler: { type: "filtering" } },
            { binding: 3, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: "uniform" } },
        ],
    });
    const module = getShaderModule(engine, system._particleBillboardMode);
    pipeline = device.createRenderPipeline({
        label: "particle-billboard-mode-pipeline",
        layout: device.createPipelineLayout({ bindGroupLayouts: [getSceneBindGroupLayout(engine), layout] }),
        vertex: { module, entryPoint: "vs", buffers: [particleBillboardModeVertexLayout(system._particleBillboardMode, false)] },
        fragment: {
            module,
            entryPoint: "fs",
            targets: [
                blendMode._descriptor ? { format: target._colorFormat!, blend: blendMode._descriptor, writeMask: CW.ALL } : { format: target._colorFormat!, writeMask: CW.ALL },
            ],
        },
        primitive: { topology: "triangle-list", cullMode: "none" },
        depthStencil: { format: target._depthStencilFormat, depthCompare: "greater-equal", depthWriteEnabled: false },
        multisample: { count: sampleCount },
    });
    cache.pipelines.set(key, pipeline);
    return pipeline;
}

function createPropertiesBuffer(engine: EngineContext, properties: ParticleRenderProperties, multiplyPass: boolean, label: string): GPUBuffer {
    const buffer = createEmptyUniformBuffer(engine, MODE_PROPERTIES_UBO_BYTES, label);
    const values = new F32(MODE_PROPERTIES_UBO_BYTES / 4);
    values[0] = properties.translationPivot.x;
    values[1] = properties.translationPivot.y;
    values[2] = multiplyPass ? 1 : 0;
    values[4] = properties.textureMask.r;
    values[5] = properties.textureMask.g;
    values[6] = properties.textureMask.b;
    values[7] = properties.textureMask.a;
    engine._device.queue.writeBuffer(buffer, 0, values);
    return buffer;
}

function createModeBindGroup(
    engine: EngineContext,
    pipeline: GPURenderPipeline,
    system: ParticleBillboardModeSystem,
    uniformBuffer: GPUBuffer,
    propertiesBuffer: GPUBuffer
): GPUBindGroup {
    return engine._device.createBindGroup({
        layout: pipeline.getBindGroupLayout(1),
        entries: [
            { binding: 0, resource: { buffer: uniformBuffer } },
            { binding: 1, resource: system.atlas.texture.view },
            { binding: 2, resource: system.atlas.texture.sampler },
            { binding: 3, resource: { buffer: propertiesBuffer } },
        ],
    });
}

/** @internal Pack logical or sorted mode instances into reusable interleaved staging. */
export function packParticleBillboardModeInstances(system: ParticleBillboardModeSystem, target: Float32Array, sourceIndices?: Uint32Array, foX = 0, foY = 0, foZ = 0): void {
    const count = system.count;
    const source = system._instanceData;
    const sourceStride = system._instanceFloatsPerSprite;
    const targetStride = particleBillboardModeInstanceFloats(system._particleBillboardMode);
    const directions = system._particleDirections;
    for (let outputIndex = 0; outputIndex < count; outputIndex++) {
        const sourceIndex = sourceIndices?.[outputIndex] ?? outputIndex;
        const sourceOffset = sourceIndex * sourceStride;
        const targetOffset = outputIndex * targetStride;
        for (let field = 0; field < BILLBOARD_INSTANCE_FLOATS_PER_SPRITE; field++) {
            target[targetOffset + field] = source[sourceOffset + field]!;
        }
        const anchorOffset = sourceIndex * 3;
        target[targetOffset] = system._anchor[anchorOffset]! - foX;
        target[targetOffset + 1] = system._anchor[anchorOffset + 1]! - foY;
        target[targetOffset + 2] = system._anchor[anchorOffset + 2]! - foZ;
        if (directions) {
            const directionOffset = sourceIndex * MODE_DIRECTION_FLOATS;
            target[targetOffset + BILLBOARD_INSTANCE_FLOATS_PER_SPRITE] = directions[directionOffset]!;
            target[targetOffset + BILLBOARD_INSTANCE_FLOATS_PER_SPRITE + 1] = directions[directionOffset + 1]!;
            target[targetOffset + BILLBOARD_INSTANCE_FLOATS_PER_SPRITE + 2] = directions[directionOffset + 2]!;
        }
    }
}

/** @internal Build one specialized mode renderable for focused rendering tests and deferred scene registration. */
export function buildParticleBillboardModeRenderable(
    engine: EngineContext,
    system: ParticleBillboardModeSystem,
    properties: ParticleRenderProperties
): { renderable: Renderable; dispose: () => void } {
    const device = engine._device;
    const strideFloats = particleBillboardModeInstanceFloats(system._particleBillboardMode);
    const strideBytes = strideFloats * 4;
    let instanceCapacity = system._capacity;
    let instanceBuffer = device.createBuffer({ label: "particle-billboard-mode-instances", size: instanceCapacity * strideBytes, usage: BU.VERTEX | BU.COPY_DST });
    let staging = new F32(instanceCapacity * strideFloats);
    const indexBuffer = createMappedBuffer(engine, BILLBOARD_INDEX_DATA, BU.INDEX);
    const uniformBuffer = createEmptyUniformBuffer(engine, BILLBOARD_SYSTEM_UBO_BYTES, "particle-billboard-mode-system-ubo");
    const primaryProperties = createPropertiesBuffer(
        engine,
        properties,
        system.blendMode._particlePasses === 1 || system.blendMode._particlePasses === 2,
        "particle-billboard-mode-properties"
    );
    const addProperties = system.blendMode._particlePasses === 2 ? createPropertiesBuffer(engine, properties, false, "particle-billboard-mode-add-properties") : null;
    const addBlend = addProperties ? createParticleBlend(2) : null;
    const primaryBindGroups = new Map<GPURenderPipeline, GPUBindGroup>();
    const addBindGroups = new Map<GPURenderPipeline, GPUBindGroup>();
    const scratchUbo = new F32(BILLBOARD_SYSTEM_UBO_BYTES / 4);
    const lastUbo = new F32(BILLBOARD_SYSTEM_UBO_BYTES / 4);
    let uploadedVersion = -1;
    let uploadedCamera: Camera | null = null;
    let uploadedCameraViewVersion = -1;
    let drawableCount = 0;
    let uboUploaded = false;
    let disposed = false;

    const renderable: Renderable = {
        order: system.order,
        isTransparent: true,
        _direct: true,
        _worldCenter: [0, 0, 0],
        bind(bindEngine, target): DrawBinding {
            const primaryPipeline = getPipeline(bindEngine, target, system, system.blendMode);
            let primaryBindGroup = primaryBindGroups.get(primaryPipeline);
            if (!primaryBindGroup) {
                primaryBindGroup = createModeBindGroup(bindEngine, primaryPipeline, system, uniformBuffer, primaryProperties);
                primaryBindGroups.set(primaryPipeline, primaryBindGroup);
            }
            const addPipeline = addBlend ? getPipeline(bindEngine, target, system, addBlend) : null;
            let addBindGroup = addPipeline ? addBindGroups.get(addPipeline) : undefined;
            if (addPipeline && !addBindGroup) {
                addBindGroup = createModeBindGroup(bindEngine, addPipeline, system, uniformBuffer, addProperties!);
                addBindGroups.set(addPipeline, addBindGroup);
            }
            return {
                renderable,
                pipeline: primaryPipeline,
                update(context) {
                    uploadModeInstances(context);
                },
                draw(pass) {
                    if (disposed || !system.visible || system.count === 0 || drawableCount === 0) {
                        return 0;
                    }
                    pass.setBindGroup(1, primaryBindGroup!);
                    pass.setIndexBuffer(indexBuffer, "uint16");
                    pass.setVertexBuffer(0, instanceBuffer);
                    pass.drawIndexed(6, system.count, 0, 0, 0);
                    if (!addPipeline || !addBindGroup) {
                        return 1;
                    }
                    pass.setPipeline(addPipeline);
                    pass.setBindGroup(1, addBindGroup);
                    pass.drawIndexed(6, system.count, 0, 0, 0);
                    pass.setPipeline(primaryPipeline);
                    return 2;
                },
            };
        },
    };

    function uploadModeInstances(context: DrawUpdateContext): void {
        if (disposed) {
            return;
        }
        const count = system.count;
        if (!system.visible || count === 0) {
            if (count === 0) {
                uploadedVersion = system._version;
                drawableCount = 0;
                const center = renderable._worldCenter!;
                center[0] = 0;
                center[1] = 0;
                center[2] = 0;
            }
            return;
        }
        if (system._capacity > instanceCapacity) {
            instanceBuffer.destroy();
            instanceCapacity = system._capacity;
            instanceBuffer = device.createBuffer({ label: "particle-billboard-mode-instances", size: instanceCapacity * strideBytes, usage: BU.VERTEX | BU.COPY_DST });
            staging = new F32(instanceCapacity * strideFloats);
            uploadedVersion = -1;
            uploadedCamera = null;
            uploadedCameraViewVersion = -1;
        }
        const camera = context._camera ?? null;
        if (uploadedVersion !== system._version || uploadedCamera !== camera || uploadedCameraViewVersion !== (camera?.worldMatrixVersion ?? -1)) {
            let foX = 0;
            let foY = 0;
            let foZ = 0;
            if (engine.useFloatingOrigin && camera) {
                foX = camera.worldMatrix[12]!;
                foY = camera.worldMatrix[13]!;
                foZ = camera.worldMatrix[14]!;
            }
            packParticleBillboardModeInstances(system, staging, undefined, foX, foY, foZ);
            device.queue.writeBuffer(instanceBuffer, 0, staging.buffer, staging.byteOffset, count * strideBytes);
            uploadedVersion = system._version;
            uploadedCamera = camera;
            uploadedCameraViewVersion = camera?.worldMatrixVersion ?? -1;
            refreshWorldCenter();
        }
        buildBillboardSystemUbo(system, scratchUbo);
        writeBillboardSystemUboIfDirty(device, uniformBuffer, scratchUbo, lastUbo, !uboUploaded);
        uboUploaded = true;
    }

    function refreshWorldCenter(): void {
        const center = renderable._worldCenter!;
        const data = system._instanceData;
        const stride = system._instanceFloatsPerSprite;
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;
        drawableCount = 0;
        for (let index = 0; index < system.count; index++) {
            const offset = index * stride;
            if (data[offset + 3] === 0 || data[offset + 4] === 0) {
                continue;
            }
            const anchorOffset = index * 3;
            const x = system._anchor[anchorOffset]!;
            const y = system._anchor[anchorOffset + 1]!;
            const z = system._anchor[anchorOffset + 2]!;
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            minZ = Math.min(minZ, z);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
            maxZ = Math.max(maxZ, z);
            drawableCount++;
        }
        if (drawableCount === 0) {
            center[0] = 0;
            center[1] = 0;
            center[2] = 0;
        } else {
            center[0] = (minX + maxX) * 0.5;
            center[1] = (minY + maxY) * 0.5;
            center[2] = (minZ + maxZ) * 0.5;
        }
    }

    applyParticleRenderingGroup(renderable, properties.renderingGroupId);
    return {
        renderable,
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            instanceBuffer.destroy();
            indexBuffer.destroy();
            uniformBuffer.destroy();
            primaryProperties.destroy();
            addProperties?.destroy();
            primaryBindGroups.clear();
            addBindGroups.clear();
        },
    };
}

/** Register a serialized particle billboard mode with exact render properties and picking. */
export function addParticleBillboardModeSystem(scene: SceneContext, system: ParticleBillboardModeSystem, blendMode: number, properties: ParticleRenderProperties): () => void {
    (system as { blendMode: FacingBillboardSpriteSystem["blendMode"] }).blendMode = createParticleBlend(blendMode);
    const pickSource: ParticleBillboardModePickSource = { system, properties };
    return addParticleSceneRenderable(
        scene,
        pickSource,
        () => import("./particle-billboard-modes-pick.js"),
        (engine) => buildParticleBillboardModeRenderable(engine, system, properties)
    );
}
