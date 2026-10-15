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
import type { ParticleBuffer } from "../particle-buffer.js";
import { createParticleSystem, type ParticleEmitterInverse, type ParticleSystem } from "../particle-system.js";
import type { NpeGetter, NpeValue } from "./npe-value.js";
import { loadNpeBlockEvaluator } from "./npe-registry.js";
import { parseParticleInputValue } from "./npe-input.js";
import {
    NODE_PARTICLE_CLASS_PREFIX_LENGTH,
    NPE_FEATURE_GENERAL,
    NPE_FEATURE_FLOW_MAP,
    NPE_FEATURE_NOISE,
    NPE_FEATURE_CONTEXTUAL_INT,
    NPE_TYPE_INT,
    NPE_CONTEXTUAL_DIRECTION,
    NPE_CONTEXTUAL_SCALED_DIRECTION,
    NPE_CONTEXTUAL_SCALED_COLOR_STEP,
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
        variant = contextualSource === NPE_CONTEXTUAL_DIRECTION || (contextualSource > NPE_CONTEXTUAL_SCALED_DIRECTION && contextualSource !== NPE_CONTEXTUAL_SCALED_COLOR_STEP);
    } else if (className === "ParticleMathBlock" && !block._evaluatorClassName) {
        const left = findInput(block, "left");
        variant = left?.targetBlockId != null && left.targetBlockId === findInput(block, "right")?.targetBlockId;
    } else if (className === "SystemBlock") {
        variant = isInputConnected(findInput(block, "emitRate"));
    }

    return variant ? await (await loadVariants()).load(block) : ((await loadCompiledEvaluator?.(block)) ?? (await loadNpeBlockEvaluator(className)));
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
            featureBits |= input.valueType === "int" ? NPE_FEATURE_GENERAL : 0;
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

    return { _systems: systems };
}

/** A built data-oriented particle set. */
export interface NodeParticleSet {
    readonly systems: ParticleSystem[];
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
    buildPromises: Promise<void>[]
): ParticleSystem {
    const systemBlock = operations[operations.length - 2] as ParsedParticleBlock;

    const capacity = typeof systemBlock.capacity === "number" ? systemBlock.capacity : 1000;
    const system = createParticleSystem(capacity);

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
    };

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
    const systems: ParticleSystem[] = [];
    const buildPromises: Promise<void>[] = [];
    for (const operations of program._systems) {
        systems.push(instantiateNodeParticlePlan(engine, scene, operations, options, buildPromises));
    }
    await Promise.all(buildPromises);
    return { systems };
}

/** @internal Instantiate one reusable executable system plan. */
export async function instantiateNodeParticleSystem(
    engine: EngineContext,
    scene: SceneContext,
    plan: NodeParticleSystemPlan,
    options: BuildNodeParticleOptions = {}
): Promise<ParticleSystem> {
    const program: NodeParticleProgram = { _systems: [plan] };
    return (await instantiateNodeParticleProgram(engine, scene, program, options)).systems[0]!;
}
