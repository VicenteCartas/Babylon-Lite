import type { NpeBlockEvaluator } from "./npe-build.js";

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
    /** @internal */
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

/** Opaque executable node-particle program produced by {@link compileNodeParticleGraph}. */
export interface NodeParticleProgram {
    /** @internal Per-system alternating block/evaluator entries in post-order. */
    readonly _systems: readonly NodeParticleSystemPlan[];
}
