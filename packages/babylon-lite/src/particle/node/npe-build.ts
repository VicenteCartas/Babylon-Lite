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
import type { Vec3, Mat4, Vec2, Color4 } from "../../math/types.js";
import { mat4Translation } from "../../math/mat4-translation.js";
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

const loadVariants = () => import("./npe-registry-variants.js");

function isInputConnected(input: ParsedParticleInput | undefined): input is ParsedParticleInput & { targetBlockId: number; targetConnectionName: string } {
    return input?.targetBlockId != null && input.targetConnectionName != null;
}

function findInput(block: ParsedParticleBlock, name: string): ParsedParticleInput | undefined {
    return block.inputs.find((input) => input.name.trim() === name);
}

/** Parse a literal value serialized directly on an unconnected input. */
function parseInputLiteral(input: ParsedParticleInput): NpeValue | undefined {
    const value = input.value;
    if (value == null) {
        return undefined;
    }
    if (typeof value === "number") {
        return value;
    }
    if (input.valueType === "number") {
        return undefined;
    }
    if (Array.isArray(value)) {
        const array = value as number[];
        switch (input.valueType) {
            case "BABYLON.Vector2":
                return { x: array[0] ?? 0, y: array[1] ?? 0 } as Vec2;
            case "BABYLON.Vector3":
                return { x: array[0] ?? 0, y: array[1] ?? 0, z: array[2] ?? 0 } as Vec3;
            case "BABYLON.Color4":
                return { r: array[0] ?? 0, g: array[1] ?? 0, b: array[2] ?? 0, a: array[3] ?? 1 } as Color4;
            default:
                return undefined;
        }
    }
    return undefined;
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
    const className = block.customType.slice(8);
    const contextualSource = typeof block.contextualValue === "number" ? block.contextualValue : 0;
    const onceValueType = findInput(block, "min")?.valueType ?? findInput(block, "max")?.valueType ?? "number";
    const scalarOnce = className === "ParticleRandomBlock" && block.lockMode === 3 && onceValueType[0] !== "B";
    const left = findInput(block, "left");
    const right = findInput(block, "right");
    const localShape = isLocal && className.endsWith("ShapeBlock");
    const variant =
        (className === "ParticleInputBlock" && contextualSource !== 0 && !((contextualSource <= 6 && contextualSource !== 2) || contextualSource === 0x17)) ||
        (className === "ParticleRandomBlock" && block.lockMode === 3 && !scalarOnce) ||
        (className === "ParticleMathBlock" && !block._evaluatorClassName && left?.targetBlockId != null && left.targetBlockId === right?.targetBlockId) ||
        (className === "SystemBlock" && isInputConnected(findInput(block, "emitRate"))) ||
        (className === "SetupSpriteSheetBlock" && block.randomStartCell === true);
    return scalarOnce
        ? (await import("./blocks/particle-random-once-block.js")).particleRandomOnceBlock
        : localShape
          ? await (await import("./npe-registry-local-shapes.js")).load(className)
          : variant
            ? await (await loadVariants()).load(block)
            : ((await loadCompiledEvaluator?.(block)) ?? (await loadNpeBlockEvaluator(className)));
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

/** Compile immutable parsed NPE data into a reusable executable program. */
export async function compileNodeParticleGraph(parsed: ParsedNodeParticleGraph): Promise<NodeParticleProgram> {
    const blocks = new Map<number, CompiledParticleBlock>();
    const systemBlockIds: number[] = [];
    let featureBits = 0;
    for (const block of parsed.blocks) {
        blocks.set(block.id, block);
        const className = block.customType.slice(8);
        const intInput = className === "ParticleInputBlock" && block.type === 0x0001;
        for (const input of block.inputs) {
            featureBits |= (input.valueType === "int" ? 1 : 0) | (input.targetConnectionName === "system" ? 8 : 0);
        }
        featureBits |= intInput
            ? block.contextualValue
                ? 0x10
                : 1
            : className[0] === "U"
              ? className[6] === "F"
                  ? 2
                  : className[6] === "N"
                    ? 4
                    : 0
              : /^Particle(TeleportOut|LocalVariable|Elbow|Debug|FloatToInt|NumberMath|Clamp|Step)Block$/.test(className)
                ? 1
                : 0;
        if (className === "SystemBlock") {
            systemBlockIds.push(block.id);
        }
    }
    if (featureBits & 0x10) {
        featureBits = (featureBits & 0x0f) | (await (await loadVariants()).c(blocks));
    }
    const graph: CompilableNodeParticleGraph = { blocks, systemBlockIds, _features: featureBits };
    if (featureBits) {
        const features = await (await import("./npe-feature-compilation.js")).compile(graph, compileOperations);
        return { _systems: features.systems };
    }

    const systems = [];
    for (const systemBlockId of systemBlockIds) {
        const operations: Array<CompiledParticleBlock | NpeBlockEvaluator> = [];
        await compileOperations(blocks, systemBlockId, operations);
        systems.push(operations);
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
export async function buildNodeParticleSet(
    engine: EngineContext,
    scene: SceneContext,
    program: NodeParticleProgram,
    options: BuildNodeParticleOptions = {}
): Promise<NodeParticleSet> {
    const systems: ParticleSystem[] = [];
    const buildPromises: Promise<void>[] = [];

    for (const operations of program._systems) {
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
            emitterWorldMatrix = mat4Translation(e.x, e.y, e.z);
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
                    throw new Error(`NodeParticle: unresolved connection ${block.customType.slice(8)}.${name}`);
                }
                if (input) {
                    const literal = parseInputLiteral(input);
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
        systems.push(system);
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
    return (await buildNodeParticleSet(engine, scene, { _systems: [plan] }, options)).systems[0]!;
}
