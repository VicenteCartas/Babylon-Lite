import type { NpeBlockEvaluator, NpeBuildState } from "./npe-build.js";

/** A parsed connection on a block input. `targetBlockId === null` means the input is unconnected. */
export interface ParsedParticleInput {
    readonly name: string;
    readonly targetBlockId: number | null;
    readonly targetConnectionName: string | null;
    /** Literal value serialized on the input itself (used when unconnected), if any. */
    readonly value?: unknown;
    /** Type tag for {@link value} (e.g. `number`, `BABYLON.Vector3`, `BABYLON.Color4`). */
    readonly valueType?: string;
}

/** A parsed graph block. The raw `serialized` object carries block-specific fields. */
export interface ParsedParticleBlock {
    readonly id: number;
    /** Class name with the `BABYLON.` prefix stripped (e.g. `SystemBlock`). */
    readonly className: string;
    readonly name: string;
    readonly inputs: readonly ParsedParticleInput[];
    /** Raw serialized block, for block-specific fields (value, type, url, operation, lockMode, capacity, …). */
    readonly serialized: Readonly<Record<string, unknown>>;
}

/** Immutable parsed node-particle source data. */
export interface ParsedNodeParticleGraph {
    readonly blocks: ReadonlyMap<number, ParsedParticleBlock>;
    /** Ids of the `SystemBlock` roots — one runtime system is built per root. */
    readonly systemBlockIds: readonly number[];
}

/** A block after graph compilation. Its serialized class identity is preserved. */
export interface CompiledParticleBlock extends ParsedParticleBlock {
    /** @internal Evaluator implementation selected independently of the serialized class name. */
    readonly _evaluatorClassName?: string;
}

/** Typed-array storage used by a compiled optional particle column. */
export type NodeParticleColumnStorage = "float64" | "float32" | "uint32" | "uint16" | "uint8" | "int32";

/** One optional particle column required by a compiled system. */
export interface NodeParticleColumnRequirement {
    readonly name: string;
    readonly storage: NodeParticleColumnStorage;
}

/** Per-system optional storage selected during graph compilation. */
export interface NodeParticleResourceManifest {
    readonly columns: readonly NodeParticleColumnRequirement[];
}

/** Frame-preparation operation required by a compiled particle system. */
export type NodeParticlePrepareFrameEffect = "localVariableLoopEpoch";

/** Per-system lifecycle effects selected during graph compilation. */
export interface NodeParticleSystemEffectManifest {
    readonly prepareFrame: readonly NodeParticlePrepareFrameEffect[];
}

/** One late-bound frame value required by a compiled particle block. */
export interface NodeParticleFrameBindingRequirement {
    readonly blockId: number;
    readonly kind: "flowMapViewProjection";
}

/** Per-system external values sampled at frame boundaries. */
export interface NodeParticleBindingManifest {
    readonly frame: readonly NodeParticleFrameBindingRequirement[];
}

/** A reusable compiled `SystemBlock` template. */
export interface NodeParticleSystemTemplate {
    readonly systemBlockId: number;
    readonly resources: NodeParticleResourceManifest;
    readonly effects?: NodeParticleSystemEffectManifest;
    readonly bindings?: NodeParticleBindingManifest;
}

/** Immutable executable node-particle program produced by {@link compileNodeParticleGraph}. */
export interface NodeParticleProgram {
    readonly blocks: ReadonlyMap<number, CompiledParticleBlock>;
    readonly systemTemplates: readonly NodeParticleSystemTemplate[];
    /** @internal Optional evaluator resolver installed by an opt-in compiler extension. */
    _loadEvaluator?: (block: ParsedParticleBlock) => Promise<NpeBlockEvaluator>;
    /** @internal Optional system-effect installer retained by an opt-in compiler extension. */
    _installSystemEffects?: (template: NodeParticleSystemTemplate, state: NpeBuildState) => void;
    /** @internal Runtime brand preventing parsed data from reaching instantiation. */
    readonly _compiled: true;
}
