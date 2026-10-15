import type { NpeBlockEvaluator } from "./npe-build.js";

/** Topology routing or propagated value types require the general compiler. */
export const NPE_FEATURE_GENERAL = 1;
/** Flow-map updates require their optional evaluator. */
export const NPE_FEATURE_FLOW_MAP = 2;
/** Noise updates require their optional evaluator. */
export const NPE_FEATURE_NOISE = 4;
/** System connections require reusable sub-emitter plans. */
export const NPE_FEATURE_SUB_EMITTERS = 8;
/** Contextual Int inputs need sprite-cell reachability detection before value-type compilation. */
export const NPE_FEATURE_CONTEXTUAL_INT = 0x10;
/** Sprite-cell Int values reaching math require propagated value types. */
export const NPE_FEATURE_SPRITE_CELL_VALUE_TYPES = NPE_FEATURE_GENERAL | NPE_FEATURE_CONTEXTUAL_INT;

/** Length of the trusted serialized `BABYLON.` class namespace. */
export const NODE_PARTICLE_CLASS_PREFIX_LENGTH = 8;

// Serialized NodeParticleBlockConnectionPointTypes, NodeParticleContextualSources, and system-source ids.
export const NPE_TYPE_INT = 0x0001;
export const NPE_CONTEXTUAL_DIRECTION = 0x0002;
export const NPE_CONTEXTUAL_SCALED_DIRECTION = 0x0006;
export const NPE_CONTEXTUAL_SPRITE_CELL_INDEX = 0x0010;
export const NPE_CONTEXTUAL_SPRITE_CELL_START = 0x0011;
export const NPE_CONTEXTUAL_SPRITE_CELL_END = 0x0012;
export const NPE_CONTEXTUAL_SCALED_COLOR_STEP = 0x0017;
export const NPE_CONTEXTUAL_LOCAL_POSITION_UPDATED = 0x0018;
export const NPE_SYSTEM_CAMERA_POSITION = 4;

/** Discriminates FlowMap/Noise in trusted `BABYLON.Update{FlowMap,Noise}Block` names. */
export const NODE_PARTICLE_UPDATE_KIND_INDEX = 14;

/** A serialized connection on a block input. */
export interface ParsedParticleInput {
    readonly name: string;
    readonly targetBlockId?: number;
    readonly targetConnectionName?: string;
    /** Literal value serialized on the input itself (used when unconnected), if any. */
    readonly value?: unknown;
    /** Type tag for {@link value} (e.g. `number`, `BABYLON.Vector3`, `BABYLON.Color4`). */
    readonly valueType?: string;
}

/** A trusted block serialized by the Node Particle Editor. */
export interface ParsedParticleBlock {
    readonly id: number;
    readonly customType: string;
    readonly name?: string;
    readonly inputs: readonly ParsedParticleInput[];
    readonly [key: string]: unknown;
}

/** Trusted Node Particle Editor source accepted by the compiler. */
export interface ParsedNodeParticleGraph {
    readonly blocks: readonly ParsedParticleBlock[];
}

/** @internal Temporary graph lookup state used only during compilation. */
export interface CompilableNodeParticleGraph {
    readonly blocks: ReadonlyMap<number, CompiledParticleBlock>;
    readonly systemBlockIds: readonly number[];
    /** @internal Bitmask of NPE_FEATURE_* compiler requirements; not serialized. */
    readonly _features: number;
}

/** A block after graph compilation. Its serialized class identity is preserved. */
export interface CompiledParticleBlock extends ParsedParticleBlock {
    /** @internal Evaluator implementation selected independently of the serialized class name. */
    readonly _evaluatorClassName?: string;
    /** @internal Reusable system plans keyed by the consuming input name. */
    readonly _systemPlans?: Readonly<Record<string, NodeParticleSystemPlan>>;
}

/** @internal Reusable executable operations for one system. */
export type NodeParticleSystemPlan = readonly (CompiledParticleBlock | NpeBlockEvaluator)[];

/** @internal Immutable metadata for one reachable named constant input. */
export type NodeParticleInputPlan = ParsedParticleBlock;

/** Opaque executable node-particle program produced by {@link compileNodeParticleGraph}. */
export interface NodeParticleProgram {
    /** @internal Per-system alternating block/evaluator entries in post-order. */
    readonly _systems: readonly NodeParticleSystemPlan[];
    /** @internal Reachable named constant inputs after serialized-order name collision resolution. */
    readonly _inputs: readonly NodeParticleInputPlan[];
    /** @internal True only when the executable plans contain Phase 13 system flow. */
    readonly _subEmitters?: true;
}
