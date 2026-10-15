import { F32 } from "../engine/typed-arrays.js";
import { SS } from "../engine/gpu-flags.js";
import type { EngineContext } from "../engine/engine.js";
import type { Color4, Vec2 } from "../math/types.js";
import type { Renderable } from "../render/renderable.js";
import { getSceneBindGroupLayout } from "../render/scene-helpers.js";
import { _registerTransparentSortCompare } from "../render/transparent-sort-hook.js";
import { createEmptyUniformBuffer } from "../resource/gpu-buffers.js";
import type { SceneContext } from "../scene/scene-core.js";
import { addDeferredSceneRenderables } from "../scene/scene-core.js";
import { SCENE_UBO_WGSL } from "../shader/scene-uniforms.js";
import type { BillboardCustomShader } from "../sprite/billboard-custom-shader.js";
import type { buildBillboardRenderable } from "../sprite/billboard-renderable.js";
import {
    BILLBOARD_SYSTEM_UBO_BYTES,
    buildBillboardSystemUbo,
    createBillboardPipelineCache,
    createBillboardSystemBindGroup,
    getOrCreateBillboardPipeline,
    makeBillboardBasisWgsl,
    resetBillboardPipelineCache,
    writeBillboardSystemUboIfDirty,
} from "../sprite/billboard-pipeline.js";
import type { BillboardOrientation, BillboardSpriteSystem, BillboardSpriteSystemOptions, FacingBillboardSpriteSystem } from "../sprite/billboard-sprite.js";
import type { SpriteLayerFx } from "../sprite/custom-shader-core.js";
import type { BillboardFxHook } from "../sprite/sprite-fx-hook.js";
import { _registerBillboardFxHook } from "../sprite/sprite-fx-hook.js";
import { registerPickSource } from "../picking/pick-contributor.js";
import { createParticleBlend } from "./particle-blend.js";
import type { ParticleRenderPropertiesPickSource } from "./particle-billboard-render-properties-pick.js";

/** @internal Immutable SystemBlock render properties captured at instantiation. */
export interface ParticleRenderProperties {
    readonly translationPivot: Vec2;
    readonly textureMask: Color4;
    readonly renderingGroupId: number;
}

/** @internal Byte size of the fixed translation-pivot, pass, and texture-mask UBO. */
export const PARTICLE_RENDER_PROPERTIES_UBO_BYTES = 32;
const EMPTY_SHADER_PARAMS: readonly number[] = [0, 0, 0, 0];
let _shaderModules: WeakMap<GPUDevice, Map<BillboardOrientation, GPUShaderModule>> | null = null;

const RENDER_PROPERTIES_SHADER_HOOK: BillboardFxHook = {
    initSystem(system, options: BillboardSpriteSystemOptions) {
        if (options.customShader) {
            (system as { _customShader?: BillboardCustomShader })._customShader = options.customShader;
            system.shaderParams = [0, 0, 0, 0];
        }
    },
    pipelineKeyPart(system) {
        return system._customShader?._key ?? "";
    },
    shaderModule(engine, system) {
        return system._customShader?._getShaderModule(engine, system._orientation, system._depthMode) ?? null;
    },
    layoutEntries(system, startBinding) {
        return system._customShader?._layoutEntries(startBinding) ?? null;
    },
    createLayerFx(engine, label, system) {
        return system._customShader?._createLayerFx(engine, label) ?? null;
    },
    updateFx(fx, system, deltaMs) {
        fx.update(system.shaderParams ?? EMPTY_SHADER_PARAMS, deltaMs);
    },
    bindEntries(fx, startBinding) {
        return fx.bindEntries(startBinding);
    },
    disposeFx(fx) {
        fx.destroy();
    },
};

function makeRenderPropertiesWgsl(orientation: BillboardOrientation): string {
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
${makeBillboardBasisWgsl(orientation)}
struct I {
@builtin(vertex_index) vid: u32,
@location(0) p: vec3f,
@location(1) s: vec2f,
@location(2) a: vec2f,
@location(3) b: vec2f,
@location(4) r: f32,
@location(5) o: vec2f,
@location(6) c: vec4f,
};
struct O {
@builtin(position) p: vec4f,
@location(0) uv: vec2f,
@location(1) tint: vec4f,
};
@vertex
fn vs(in: I) -> O {
let q = vec2f(select(0.0, 1.0, in.vid == 1u || in.vid == 2u), select(0.0, 1.0, in.vid >= 2u));
let l = (q - in.o - properties.translationPivot) * in.s;
let cr = cos(in.r);
let sr = sin(in.r);
let r = vec2f(l.x * cr - l.y * sr, l.x * sr + l.y * cr) + properties.translationPivot;
let b = basis(in.p);
let wp = in.p + b.r * r.x + b.u * r.y;
var out: O;
out.p = scene.viewProjection * vec4f(wp, 1);
out.uv = mix(in.a, in.b, q);
out.tint = in.c;
return out;
}
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

function getShaderModule(engine: EngineContext, orientation: BillboardOrientation): GPUShaderModule {
    _shaderModules ??= new WeakMap();
    let modules = _shaderModules.get(engine._device);
    if (!modules) {
        modules = new Map();
        _shaderModules.set(engine._device, modules);
    }
    let module = modules.get(orientation);
    if (!module) {
        module = engine._device.createShaderModule({ code: makeRenderPropertiesWgsl(orientation) });
        modules.set(orientation, module);
    }
    return module;
}

function createPropertiesFx(engine: EngineContext, label: string, properties: ParticleRenderProperties, multiplyPass: boolean): SpriteLayerFx {
    const buffer = createEmptyUniformBuffer(engine, PARTICLE_RENDER_PROPERTIES_UBO_BYTES, label);
    const values = new F32(PARTICLE_RENDER_PROPERTIES_UBO_BYTES / 4);
    values[0] = properties.translationPivot.x;
    values[1] = properties.translationPivot.y;
    values[2] = multiplyPass ? 1 : 0;
    values[4] = properties.textureMask.r;
    values[5] = properties.textureMask.g;
    values[6] = properties.textureMask.b;
    values[7] = properties.textureMask.a;
    engine._device.queue.writeBuffer(buffer, 0, values.buffer, values.byteOffset, PARTICLE_RENDER_PROPERTIES_UBO_BYTES);
    return {
        bindEntries(startBinding) {
            return [{ binding: startBinding, resource: { buffer } }];
        },
        update() {},
        destroy() {
            buffer.destroy();
        },
    };
}

function createRenderPropertiesShader(properties: ParticleRenderProperties, multiplyPass: boolean): BillboardCustomShader {
    return {
        _entityType: "billboard-custom-shader",
        _extraTextures: [],
        _key: "particle-render-properties",
        _composeWgsl: (orientation) => makeRenderPropertiesWgsl(orientation),
        _getShaderModule: (engine, orientation) => getShaderModule(engine, orientation),
        _layoutEntries: (startBinding) => [{ binding: startBinding, visibility: SS.VERTEX | SS.FRAGMENT, buffer: { type: "uniform" } }],
        _createLayerFx: (engine, label) => createPropertiesFx(engine, label, properties, multiplyPass),
    };
}

function attachRenderPropertiesShader(system: BillboardSpriteSystem, properties: ParticleRenderProperties, multiplyPass: boolean): void {
    _registerBillboardFxHook(RENDER_PROPERTIES_SHADER_HOOK);
    (system as { _customShader?: BillboardCustomShader })._customShader = createRenderPropertiesShader(properties, multiplyPass);
    system.shaderParams = undefined;
}

function compareRenderingGroups(left: { renderable: Renderable }, right: { renderable: Renderable }): number {
    return (left.renderable._renderingGroupId ?? 0) - (right.renderable._renderingGroupId ?? 0);
}

/** Add a facing billboard with exact SystemBlock render properties and particle blend state. */
export function addFacingBillboardSystemWithParticleRenderProperties(
    scene: SceneContext,
    billboard: FacingBillboardSpriteSystem,
    blendMode: number,
    properties: ParticleRenderProperties
): () => void {
    const blend = createParticleBlend(blendMode);
    (billboard as { blendMode: FacingBillboardSpriteSystem["blendMode"] }).blendMode = blend;
    attachRenderPropertiesShader(billboard, properties, blendMode === 3 || blendMode === 4);
    _registerTransparentSortCompare(compareRenderingGroups);
    let unregisterPick: () => void;
    if (properties.translationPivot.x || properties.translationPivot.y) {
        const pickSource: ParticleRenderPropertiesPickSource = { system: billboard, translationPivot: properties.translationPivot };
        unregisterPick = registerPickSource(scene, pickSource, () => import("./particle-billboard-render-properties-pick.js"));
    } else {
        unregisterPick = registerPickSource(scene, billboard, () => import("../picking/billboard-pick-pipeline.js"));
    }
    const unregisterRender = addDeferredSceneRenderables(scene, async (engine) => {
        const { buildBillboardRenderable } = await import("../sprite/billboard-renderable.js");
        const built = buildParticleRenderPropertiesBillboardRenderable(engine, billboard, properties, buildBillboardRenderable);
        return { renderables: [built.renderable], dispose: built.dispose };
    });
    let disposed = false;
    const unregister = () => {
        if (disposed) {
            return;
        }
        disposed = true;
        unregisterPick();
        unregisterRender();
        if (!scene._z) {
            const index = scene._disposables.indexOf(unregister);
            if (index !== -1) {
                scene._disposables.splice(index, 1);
            }
        }
    };
    scene._disposables.splice(scene._disposables.indexOf(unregisterRender), 0, unregister);
    return unregister;
}

/** @internal Build the property shader and optional Add pass over one billboard renderable. */
export function buildParticleRenderPropertiesBillboardRenderable(
    engine: EngineContext,
    billboard: FacingBillboardSpriteSystem,
    properties: ParticleRenderProperties,
    buildBase: typeof buildBillboardRenderable
): { renderable: Renderable; dispose: () => void } {
    const system = billboard as FacingBillboardSpriteSystem;
    const built = buildBase(engine, system);
    built.renderable._renderingGroupId = properties.renderingGroupId;
    if (system.blendMode._particlePasses !== 2) {
        return built;
    }

    const addSystem = {
        ...system,
        blendMode: createParticleBlend(2),
        _customShader: createRenderPropertiesShader(properties, false),
        shaderParams: undefined,
    } as BillboardSpriteSystem;
    const pipelineCache = createBillboardPipelineCache();
    const uniformBuffer = createEmptyUniformBuffer(engine, BILLBOARD_SYSTEM_UBO_BYTES, "particle-render-properties-add-system-ubo");
    const addFx = createPropertiesFx(engine, "particle-render-properties-add-ubo", properties, false);
    const bindGroups = new Map<GPURenderPipeline, GPUBindGroup>();
    const scratchUbo = new F32(BILLBOARD_SYSTEM_UBO_BYTES / 4);
    const lastUbo = new F32(BILLBOARD_SYSTEM_UBO_BYTES / 4);
    const bindPrimary = built.renderable.bind;
    let uboUploaded = false;
    let disposed = false;

    built.renderable.bind = (bindEngine, target) => {
        if (!target._depthStencilFormat) {
            throw new Error("BillboardSpriteSystem requires a depth-stencil render target.");
        }
        const primary = bindPrimary(bindEngine, target);
        const sampleCount = target._sampleCount === 1 ? 1 : 4;
        const addPipeline = getOrCreateBillboardPipeline(
            bindEngine,
            pipelineCache,
            target._colorFormat!,
            sampleCount,
            addSystem,
            target._depthStencilFormat,
            getSceneBindGroupLayout(bindEngine)
        );
        let addBindGroup = bindGroups.get(addPipeline);
        if (!addBindGroup) {
            addBindGroup = createBillboardSystemBindGroup(bindEngine, addPipeline, addSystem, uniformBuffer, addFx);
            bindGroups.set(addPipeline, addBindGroup);
        }
        return {
            renderable: built.renderable,
            pipeline: primary.pipeline,
            update(context) {
                primary.update?.(context);
                buildBillboardSystemUbo(system, scratchUbo);
                writeBillboardSystemUboIfDirty(bindEngine._device, uniformBuffer, scratchUbo, lastUbo, !uboUploaded);
                uboUploaded = true;
            },
            draw(pass, drawEngine) {
                const primaryDraws = primary.draw(pass, drawEngine);
                if (primaryDraws === 0) {
                    return 0;
                }
                pass.setPipeline(addPipeline);
                pass.setBindGroup(1, addBindGroup);
                pass.drawIndexed(6, system.count, 0, 0, 0);
                pass.setPipeline(primary.pipeline);
                return primaryDraws + 1;
            },
        };
    };

    return {
        renderable: built.renderable,
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            built.dispose();
            uniformBuffer.destroy();
            addFx.destroy();
            bindGroups.clear();
            resetBillboardPipelineCache(pipelineCache);
        },
    };
}
