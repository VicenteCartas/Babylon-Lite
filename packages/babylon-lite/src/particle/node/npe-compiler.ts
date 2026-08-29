import type { CompiledParticleBlock, NodeParticleProgram, ParsedNodeParticleGraph, ParsedParticleBlock } from "./npe-types.js";
import type * as FrameBindings from "./npe-frame-binding-compilation.js";
import type * as SystemEffects from "./npe-system-effects.js";

/** Compile immutable parsed NPE data into a reusable executable program. */
export async function compileNodeParticleGraph(parsed: ParsedNodeParticleGraph): Promise<NodeParticleProgram> {
    let hasTopology = false;
    let hasValueMath = false;
    let hasOptionalResources = false;
    let hasSpriteResources = false;
    let hasSystemEffects = false;
    let hasFrameBindings = false;
    const copiedBlocks = new Map<number, ParsedParticleBlock>();
    for (const block of parsed.blocks.values()) {
        copiedBlocks.set(block.id, { ...block, inputs: block.inputs.map((input) => ({ ...input })) });
        const { className, serialized } = block;
        hasTopology ||= /^Particle(TeleportOut|LocalVariable|Elbow|Debug)Block$/.test(className);
        hasSystemEffects ||= className === "ParticleLocalVariableBlock" && serialized.scope !== 0;
        hasFrameBindings ||= className === "UpdateFlowMapBlock";
        hasValueMath ||=
            (className === "ParticleInputBlock" && serialized.type === 0x0001) ||
            /^Particle(FloatToInt|NumberMath|Clamp|Step)Block$/.test(className) ||
            block.inputs.some((input) => input.valueType === "int");
        hasSpriteResources ||= className === "SetupSpriteSheetBlock";
        const contextualSource = serialized.contextualValue;
        hasOptionalResources ||=
            (className === "ParticleInputBlock" && (contextualSource === 0x0013 || contextualSource === 0x0014 || contextualSource === 0x0015 || contextualSource === 0x0018)) ||
            (className === "ParticleRandomBlock" && serialized.lockMode === 3) ||
            (className === "ParticleLocalVariableBlock" && serialized.scope === 0) ||
            className === "UpdateNoiseBlock";
    }
    let graph: ParsedNodeParticleGraph = { blocks: copiedBlocks, systemBlockIds: parsed.systemBlockIds.slice() };

    if (hasTopology) {
        graph = (await import("./npe-graph-plumbing-runtime.js")).compileNodeParticleTopology(graph);
    }

    let blocks: ReadonlyMap<number, CompiledParticleBlock> = graph.blocks;
    let loadEvaluator: NodeParticleProgram["_loadEvaluator"];
    if (hasValueMath) {
        const valueCompilation = await import("./npe-value-compilation.js");
        blocks = valueCompilation.compileNodeParticleValueTypes(blocks);
        loadEvaluator = valueCompilation.loadNodeParticleValueMathEvaluator;
    }

    const compileResources = hasOptionalResources ? (await import("./npe-resource-compilation.js")).compileNodeParticleResources : undefined;
    const addSpriteResources = hasSpriteResources ? (await import("./npe-sprite-resource-compilation.js")).addNodeParticleSpriteResources : undefined;
    const systemEffects: typeof SystemEffects | undefined = hasSystemEffects ? await import("./npe-system-effects.js") : undefined;
    const frameBindings: typeof FrameBindings | undefined = hasFrameBindings ? await import("./npe-frame-binding-compilation.js") : undefined;

    return {
        blocks,
        systemTemplates: graph.systemBlockIds.map((systemBlockId) => {
            const columns = compileResources ? compileResources(blocks, systemBlockId) : [];
            if (addSpriteResources) {
                addSpriteResources(blocks, systemBlockId, columns);
            }
            const effects = systemEffects?.compileNodeParticleSystemEffects(blocks, systemBlockId);
            const bindings = frameBindings?.compileNodeParticleFrameBindings(blocks, systemBlockId);
            return {
                systemBlockId,
                resources: { columns },
                ...(effects ? { effects } : {}),
                ...(bindings ? { bindings } : {}),
            };
        }),
        _compiled: true,
        ...(loadEvaluator ? { _loadEvaluator: loadEvaluator } : {}),
        ...(systemEffects ? { _installSystemEffects: systemEffects.installNodeParticleSystemEffects } : {}),
    };
}
