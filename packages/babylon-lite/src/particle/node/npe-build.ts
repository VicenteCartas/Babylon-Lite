/**
 * Data-oriented Node-Particle build.
 *
 * Instantiates a compiled {@link NodeParticleProgram} and walks inputs in post-order, so upstream outputs
 * resolve before downstream reads and update steps retain graph order. Block evaluators produce
 * column-writing {@link ParticleStep}s and index-based {@link NpeGetter}s. One {@link ParticleSystem} is produced
 * per `SystemBlock` root.
 */
import type { EngineContext } from "../../engine/engine.js";
import type { SceneContext } from "../../scene/scene.js";
import type { Vec3, Mat4 } from "../../math/types.js";
import { createTranslationMat4 } from "../../math/create-translation-mat4.js";
import { mat4GetTranslationToRef } from "../../math/mat4-transform.js";
import type {
    CompilableNodeParticleGraph,
    CompiledParticleBlock,
    NodeParticleProgram,
    NodeParticleSystemPlan,
    ParsedNodeParticleGraph,
    ParsedParticleBlock,
    ParsedParticleInput,
} from "./npe-types.js";
import { createParticleBuffer, type ParticleBuffer } from "../particle-buffer.js";
import { createParticleSystem, type ParticleEmitterInverse, type ParticleSystem } from "../particle-system.js";
import type { NpeGetter, NpeValue } from "./npe-value.js";
import { loadNpeBlockEvaluator } from "./npe-registry.js";
import { createParticleInputHandles, parseParticleInputValue, type NpeInputCell, type ParticleInputHandle } from "./npe-input.js";
import type { NodeParticleChildHost } from "./npe-sub-emitter-runtime.js";
import {
    NODE_PARTICLE_CLASS_PREFIX_LENGTH,
    NPE_FEATURE_GENERAL,
    NPE_FEATURE_FLOW_MAP,
    NPE_FEATURE_NOISE,
    NPE_FEATURE_SUB_EMITTERS,
    NPE_FEATURE_CONTEXTUAL_INT,
    NPE_TYPE_INT,
    NPE_CONTEXTUAL_DIRECTION,
    NPE_CONTEXTUAL_SCALED_DIRECTION,
    NPE_CONTEXTUAL_SCALED_COLOR_STEP,
    NPE_SYSTEM_CAMERA_POSITION,
} from "./npe-types.js";

const loadVariants = () => import("./npe-registry-variants.js");

/** Random lock mode whose value is sampled once while building the system. */
const RANDOM_LOCK_ONCE = 3;

function isInputConnected(input: ParsedParticleInput | undefined): input is ParsedParticleInput & { targetBlockId: number; targetConnectionName: string } {
    return input?.targetBlockId != null && input.targetConnectionName != null;
}

function findInput(block: ParsedParticleBlock, name: string): ParsedParticleInput | undefined {
    return block.inputs.find((input) => input.name.trim() === name);
}

function usesSystemRenderFeatures(block: CompiledParticleBlock): boolean {
    const hasNonDefaultValue = (input: ParsedParticleInput | undefined, defaultComponent: number) =>
        isInputConnected(input) || (Array.isArray(input?.value) && input.value.some((component) => component !== defaultComponent));
    return (
        hasNonDefaultValue(findInput(block, "translationPivot"), 0) ||
        hasNonDefaultValue(findInput(block, "textureMask"), 1) ||
        !!block.renderingGroupId ||
        block.isBillboardBased === false ||
        (block.billBoardMode ?? 7) !== 7
    );
}

/** Build state shared with every block evaluator during the walk. */
export interface NpeBuildState {
    system: ParticleSystem | null;
    buffer: ParticleBuffer | null;
    capacity: number;
    emitter: Vec3;
    emitterWorldMatrix: Mat4;
    emitterInverseWorldMatrices?: ParticleEmitterInverse[];
    /** @internal Installed by the first Loop LocalVariable evaluator and shared by that system's later evaluators. */
    _localVariableLoopEpoch?: { value: number };
    /** @internal Installed by the first camera evaluator and shared by that system's later camera evaluators. */
    _cameraBinding?: { position: Vec3; view?: Mat4; ready: boolean };
    isLocal: boolean;
    scene: SceneContext;
    textureBaseUrl?: string;
}

/** Build context handed to each NPE block evaluator. */
export interface NpeBuildContext {
    state: NpeBuildState;
    engine: EngineContext;
    input(block: ParsedParticleBlock, name: string, fallback?: NpeGetter): NpeGetter;
    isConnected(block: ParsedParticleBlock, name: string): boolean;
    setOutput(blockId: number, name: string, getter: NpeGetter): void;
    addBuildPromise(promise: Promise<void>): void;
    /** @internal Resolves one exposed constant input to its set-local mutable cell. */
    _inputValue?(blockId: number): NpeGetter | undefined;
    /** @internal Creates one event-owned child from a precompiled system plan. */
    _spawnSystem?(plan: NodeParticleSystemPlan, emitter: Vec3, onDispose?: () => void): ParticleSystem | null;
}

/** An NPE block evaluator: wires a parsed block into the runtime during the build walk. */
export interface NpeBlockEvaluator {
    /** @internal Evaluators selected for named input dependencies during compilation. */
    readonly _inputEvaluators?: Readonly<Record<string, NpeBlockEvaluator>>;
    build(block: ParsedParticleBlock, ctx: NpeBuildContext): void;
}

async function resolveEvaluator(
    block: CompiledParticleBlock,
    isLocal: boolean,
    loadCompiledEvaluator: ((block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>) | undefined
): Promise<NpeBlockEvaluator> {
    const className = block.customType.slice(NODE_PARTICLE_CLASS_PREFIX_LENGTH);
    if (className === "ParticleTriggerBlock") {
        return (await import("./npe-pack-sub-emitters.js")).load(className);
    }
    if (className === "ParticleRandomBlock" && block.lockMode === RANDOM_LOCK_ONCE) {
        const valueType = findInput(block, "min")?.valueType ?? findInput(block, "max")?.valueType ?? "number";
        // Serialized vector/color tags start with "BABYLON."; primitive tags do not.
        return valueType[0] !== "B" ? (await import("./blocks/particle-random-once-block.js")).particleRandomOnceBlock : (await loadVariants()).load(block);
    }
    if (isLocal && className.endsWith("ShapeBlock")) {
        return (await import("./npe-registry-local-shapes.js")).load(className);
    }

    let variant = className === "SetupSpriteSheetBlock" && block.randomStartCell === true;
    if (className === "ParticleInputBlock") {
        const contextualSource = typeof block.contextualValue === "number" ? block.contextualValue : 0;
        const systemSource = typeof block.systemSource === "number" ? block.systemSource : 0;
        variant =
            contextualSource === NPE_CONTEXTUAL_DIRECTION ||
            (contextualSource > NPE_CONTEXTUAL_SCALED_DIRECTION && contextualSource !== NPE_CONTEXTUAL_SCALED_COLOR_STEP) ||
            (!contextualSource && systemSource === NPE_SYSTEM_CAMERA_POSITION);
    } else if (className === "ParticleMathBlock" && !block._evaluatorClassName) {
        const left = findInput(block, "left");
        variant = left?.targetBlockId != null && left.targetBlockId === findInput(block, "right")?.targetBlockId;
    } else if (className === "SystemBlock") {
        variant = isInputConnected(findInput(block, "emitRate"));
    }

    let evaluator =
        className === "SystemBlock" && usesSystemRenderFeatures(block)
            ? (await import("./npe-pack-system-render.js")).systemRenderBlock
            : variant
              ? await (await loadVariants()).load(block)
              : ((await loadCompiledEvaluator?.(block)) ?? (await loadNpeBlockEvaluator(className)));
    if (className !== "SystemBlock") {
        return evaluator;
    }
    // preWarmStepOffset only matters with preWarmCycles, so it does not select the lifecycle on its own.
    if ((block.manualEmitCount ?? -1) !== -1 || !!block.preWarmCycles || !!block.startDelay || block.disposeOnStop === true || !!block.doNoStart) {
        evaluator = (await import("./npe-system-lifecycle.js")).withSystemLifecycle(evaluator);
    }
    return block._systemPlans && (block._systemPlans.onStart || block._systemPlans.onEnd)
        ? (await import("./npe-pack-sub-emitters.js")).withSubEmitterLifecycle(evaluator)
        : evaluator;
}

async function compileOperations(
    blocks: ReadonlyMap<number, CompiledParticleBlock>,
    systemBlockId: number,
    operations: Array<CompiledParticleBlock | NpeBlockEvaluator>,
    loadCompiledEvaluator?: (block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>
): Promise<void> {
    const compiled = new Set<number | CompiledParticleBlock>();
    const isLocal = blocks.get(systemBlockId)?.isLocal === true;
    const visit = async (blockId: number, evaluatorOverride?: NpeBlockEvaluator): Promise<void> => {
        const block = blocks.get(blockId);
        if (!block) {
            return;
        }
        const compileKey = evaluatorOverride ? block : blockId;
        if (compiled.has(compileKey)) {
            return;
        }
        compiled.add(compileKey);
        const evaluator = evaluatorOverride ?? (await resolveEvaluator(block, isLocal, loadCompiledEvaluator));
        const particleInput = findInput(block, "particle");
        if (isInputConnected(particleInput)) {
            await visit(particleInput.targetBlockId, evaluator._inputEvaluators?.particle);
        }
        for (const input of block.inputs) {
            if (input !== particleInput && isInputConnected(input)) {
                await visit(input.targetBlockId, evaluator._inputEvaluators?.[input.name.trim()]);
            }
        }
        operations.push(block, evaluator);
    };
    await visit(systemBlockId);
}

function collectInputPlans(blocks: Iterable<CompiledParticleBlock>, systems: readonly NodeParticleSystemPlan[]): ParsedParticleBlock[] {
    const reachable = new Set<number>();
    for (const operations of systems) {
        for (let index = 0; index < operations.length; index += 2) {
            reachable.add((operations[index] as CompiledParticleBlock).id);
        }
    }

    const named = new Map<string, ParsedParticleBlock>();
    for (const block of blocks) {
        if (
            reachable.has(block.id) &&
            block.customType === "BABYLON.ParticleInputBlock" &&
            typeof block.name === "string" &&
            Boolean(block.name) &&
            !block.contextualValue &&
            !block.systemSource
        ) {
            named.set(block.name, block);
        }
    }
    return [...named.values()];
}

/** @internal Compile immutable parsed NPE data into a reusable executable program. */
export async function compileNodeParticleGraph(parsed: ParsedNodeParticleGraph): Promise<NodeParticleProgram> {
    const blocks = new Map<number, CompiledParticleBlock>();
    const systemBlockIds: number[] = [];
    let loadCompiledEvaluator: ((block: CompiledParticleBlock) => Promise<NpeBlockEvaluator | undefined>) | undefined;
    let featureBits = 0;
    for (const block of parsed.blocks) {
        blocks.set(block.id, block);
        const className = block.customType.slice(NODE_PARTICLE_CLASS_PREFIX_LENGTH);
        for (const input of block.inputs) {
            featureBits |= (input.valueType === "int" ? NPE_FEATURE_GENERAL : 0) | (input.targetConnectionName === "system" ? NPE_FEATURE_SUB_EMITTERS : 0);
        }
        if (className === "ParticleInputBlock" && block.type === NPE_TYPE_INT) {
            featureBits |= block.contextualValue ? NPE_FEATURE_CONTEXTUAL_INT : NPE_FEATURE_GENERAL;
        } else if (className === "UpdateFlowMapBlock") {
            featureBits |= NPE_FEATURE_FLOW_MAP;
        } else if (className === "UpdateNoiseBlock") {
            featureBits |= NPE_FEATURE_NOISE;
        } else if (/^Particle(TeleportOut|LocalVariable|Elbow|Debug|FloatToInt|NumberMath|Clamp|Step)Block$/.test(className)) {
            // Full-name switches/arrays duplicate these serialized affixes beyond the measured scene budget.
            featureBits |= NPE_FEATURE_GENERAL;
        }
        if (className === "SystemBlock") {
            systemBlockIds.push(block.id);
        }
    }
    if (featureBits & NPE_FEATURE_CONTEXTUAL_INT) {
        const variants = await loadVariants();
        featureBits = (featureBits & ~NPE_FEATURE_CONTEXTUAL_INT) | variants.c(blocks);
        loadCompiledEvaluator = variants.loadSprite;
    }
    const graph: CompilableNodeParticleGraph = { blocks, systemBlockIds, _features: featureBits };
    let systems: NodeParticleSystemPlan[];
    if (featureBits) {
        const features = await (await import("./npe-feature-compilation.js")).compile(graph, compileOperations, loadCompiledEvaluator);
        systems = features.systems;
    } else {
        systems = [];
        for (const systemBlockId of systemBlockIds) {
            const operations: Array<CompiledParticleBlock | NpeBlockEvaluator> = [];
            await compileOperations(blocks, systemBlockId, operations, loadCompiledEvaluator);
            systems.push(operations);
        }
    }

    const inputs = collectInputPlans(blocks.values(), systems);
    return featureBits & NPE_FEATURE_SUB_EMITTERS ? { _systems: systems, _inputs: inputs, _subEmitters: true } : { _systems: systems, _inputs: inputs };
}

/** A built data-oriented particle set. */
export interface NodeParticleSet {
    readonly systems: ParticleSystem[];
    readonly inputs: Readonly<Record<string, ParticleInputHandle>>;
    /** @internal Event-created descendants currently owned by this set. */
    readonly _children?: readonly ParticleSystem[];
    /** @internal Register existing and future event-created systems, returning their teardown. */
    readonly _registerChildren?: (register: (system: ParticleSystem) => void) => () => void;
}

/** Options for building a node-particle set. */
export interface BuildNodeParticleOptions {
    /** Emitter world position (translation-only emitter). Ignored when {@link BuildNodeParticleOptions.emitterWorldMatrix} is set. */
    emitter?: Vec3;
    /** Emitter world matrix (translation + rotation + scale). Takes precedence over {@link BuildNodeParticleOptions.emitter}. */
    emitterWorldMatrix?: Mat4;
    /** Base URL used to resolve relative texture URLs in the graph (mirrors BJS texture-base resolution). */
    textureBaseUrl?: string;
    /** @internal */
    _setupEmitter?: (state: NpeBuildState) => void;
}

/**
 * Instantiate data-oriented particle systems from a compiled node-particle program.
 */
function instantiateNodeParticlePlan(
    engine: EngineContext,
    scene: SceneContext,
    operations: NodeParticleSystemPlan,
    options: BuildNodeParticleOptions,
    cells: ReadonlyMap<number, NpeInputCell>,
    buildPromises: Promise<void>[],
    host?: NodeParticleChildHost
): ParticleSystem {
    const systemBlock = operations[operations.length - 2] as ParsedParticleBlock;

    const capacity = typeof systemBlock.capacity === "number" ? systemBlock.capacity : 1000;
    // Floating-origin engines keep world positions in F64 so large-world particles do not lose precision.
    const system = createParticleSystem(capacity, createParticleBuffer(capacity, engine.useFloatingOrigin ? Float64Array : Float32Array));

    let emitterWorldMatrix: Mat4;
    const emitter: Vec3 = { x: 0, y: 0, z: 0 };
    if (options.emitterWorldMatrix) {
        emitterWorldMatrix = options.emitterWorldMatrix;
        mat4GetTranslationToRef(emitterWorldMatrix, emitter);
    } else {
        const e = options.emitter ?? { x: 0, y: 0, z: 0 };
        emitterWorldMatrix = createTranslationMat4(e.x, e.y, e.z);
        emitter.x = e.x;
        emitter.y = e.y;
        emitter.z = e.z;
    }
    const state: NpeBuildState = {
        system,
        buffer: system.buffer,
        capacity,
        emitter,
        emitterWorldMatrix,
        isLocal: systemBlock.isLocal === true,
        scene,
        textureBaseUrl: options.textureBaseUrl,
    };
    options._setupEmitter?.(state);

    const outputs = new Map<string, NpeGetter>();
    const ctx: NpeBuildContext = {
        state,
        engine,
        input(block, name, fallback) {
            const input = findInput(block, name);
            if (isInputConnected(input)) {
                const getter = outputs.get(`${input.targetBlockId}:${input.targetConnectionName}`);
                if (getter) {
                    return getter;
                }
                throw new Error(`NodeParticle: unresolved connection ${block.customType.slice(NODE_PARTICLE_CLASS_PREFIX_LENGTH)}.${name}`);
            }
            if (input) {
                const literal = parseParticleInputValue(input.valueType, input.value);
                if (literal !== undefined) {
                    return () => literal;
                }
            }
            return fallback ?? (() => null as unknown as NpeValue);
        },
        isConnected(block, name) {
            const input = findInput(block, name);
            return isInputConnected(input);
        },
        setOutput(blockId, name, getter) {
            outputs.set(`${blockId}:${name}`, getter);
        },
        addBuildPromise(promise) {
            buildPromises.push(promise);
        },
        _inputValue(blockId) {
            return cells.get(blockId);
        },
    };
    if (host) {
        ctx._spawnSystem = (plan, childEmitter, onDispose) => host.spawn(system, plan, childEmitter, onDispose);
    }

    for (let index = 0; index < operations.length; index += 2) {
        (operations[index + 1] as NpeBlockEvaluator).build(operations[index] as ParsedParticleBlock, ctx);
    }
    return system;
}

/**
 * Build the data-oriented particle systems of a parsed node-particle graph.
 *
 * @param engine - The engine (used for texture loads and position precision).
 * @param scene - The hosting scene (carried in the per-particle evaluation context).
 * @param graph - A graph returned by parseNodeParticleSource.
 * @param options - Emitter placement and texture base URL.
 * @returns The built {@link NodeParticleSet}.
 */
export async function buildNodeParticleSet(
    engine: EngineContext,
    scene: SceneContext,
    graph: ParsedNodeParticleGraph,
    options: BuildNodeParticleOptions = {}
): Promise<NodeParticleSet> {
    return instantiateNodeParticleProgram(engine, scene, await compileNodeParticleGraph(graph), options);
}

/** @internal Instantiate one set from a compiled program; sub-emitters reuse its system plans. */
export async function instantiateNodeParticleProgram(
    engine: EngineContext,
    scene: SceneContext,
    program: NodeParticleProgram,
    options: BuildNodeParticleOptions = {}
): Promise<NodeParticleSet> {
    const { inputs, cells } = createParticleInputHandles(program._inputs);

    if (program._subEmitters) {
        return (await import("./npe-sub-emitter-runtime.js")).buildNodeParticleSetWithSubEmitters(program, options, inputs, (plan, childOptions, buildPromises, host) =>
            instantiateNodeParticlePlan(engine, scene, plan, childOptions, cells, buildPromises, host)
        );
    }

    const systems: ParticleSystem[] = [];
    const buildPromises: Promise<void>[] = [];
    for (const operations of program._systems) {
        systems.push(instantiateNodeParticlePlan(engine, scene, operations, options, cells, buildPromises));
    }
    await Promise.all(buildPromises);
    return { systems, inputs };
}

/** @internal Instantiate one reusable executable system plan. */
export async function instantiateNodeParticleSystem(
    engine: EngineContext,
    scene: SceneContext,
    plan: NodeParticleSystemPlan,
    options: BuildNodeParticleOptions = {}
): Promise<ParticleSystem> {
    const blocks = plan.filter((_operation, index): _operation is CompiledParticleBlock => index % 2 === 0);
    const usesSubEmitters = blocks.some((block) => block.customType === "BABYLON.ParticleTriggerBlock" || !!block._systemPlans);
    const program: NodeParticleProgram = usesSubEmitters
        ? { _systems: [plan], _inputs: collectInputPlans(blocks, [plan]), _subEmitters: true }
        : { _systems: [plan], _inputs: collectInputPlans(blocks, [plan]) };
    return (await instantiateNodeParticleProgram(engine, scene, program, options)).systems[0]!;
}
