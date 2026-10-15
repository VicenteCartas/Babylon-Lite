import type { CompiledParticleBlock, ParsedParticleBlock } from "../npe-types.js";
import { NODE_PARTICLE_CLASS_PREFIX_LENGTH, NPE_TYPE_INT } from "../npe-types.js";

function hasIntInput(blocks: ReadonlyMap<number, ParsedParticleBlock>, block: ParsedParticleBlock, inputName: string, visiting: Set<number>): boolean {
    const input = block.inputs.find((candidate) => candidate.name.trim() === inputName);
    return (
        input?.valueType === "int" ||
        (input?.targetBlockId != null && input.targetConnectionName != null && hasIntOutput(blocks, input.targetBlockId, input.targetConnectionName, visiting))
    );
}

function hasIntOutput(blocks: ReadonlyMap<number, ParsedParticleBlock>, blockId: number, outputName: string, visiting: Set<number>): boolean {
    if (visiting.has(blockId)) {
        return false;
    }
    const block = blocks.get(blockId);
    if (!block || outputName !== "output") {
        return false;
    }
    const className = block.customType.slice(NODE_PARTICLE_CLASS_PREFIX_LENGTH);
    if (className === "ParticleInputBlock") {
        return block.type === NPE_TYPE_INT;
    }
    if (className === "ParticleFloatToIntBlock") {
        return true;
    }
    visiting.add(blockId);
    let result = false;
    switch (className) {
        case "ParticleMathBlock":
            result = hasIntInput(blocks, block, "left", visiting) && hasIntInput(blocks, block, "right", visiting);
            break;
        case "ParticleConditionBlock":
            result = hasIntInput(blocks, block, "ifTrue", visiting);
            break;
        case "ParticleNumberMathBlock":
        case "ParticleLerpBlock":
            result = hasIntInput(blocks, block, "left", visiting);
            break;
        case "ParticleRandomBlock":
            result = hasIntInput(blocks, block, "min", visiting);
            break;
        case "ParticleLocalVariableBlock":
            result = hasIntInput(blocks, block, "input", visiting);
            break;
        case "ParticleClampBlock":
        case "ParticleStepBlock":
        case "ParticleSmoothStepBlock":
            result = hasIntInput(blocks, block, "value", visiting);
            break;
        case "ParticleTrigonometryBlock":
            result = hasIntInput(blocks, block, "input", visiting);
            break;
        case "ParticleNLerpBlock":
            result = hasIntInput(blocks, block, "left", visiting);
            break;
    }
    visiting.delete(blockId);
    return result;
}

/** Resolve whether a named block input carries Babylon's Int connection type. */
export function hasIntBlockInput(blocks: ReadonlyMap<number, ParsedParticleBlock> | undefined, block: ParsedParticleBlock, inputName: string): boolean {
    return blocks !== undefined && hasIntInput(blocks, block, inputName, new Set());
}

/** Compile propagated Int types and evaluator variants without mutating parsed blocks. */
export function resolveParticleValueTypes(blocks: ReadonlyMap<number, ParsedParticleBlock>): ReadonlyMap<number, CompiledParticleBlock> {
    const compiled = new Map<number, CompiledParticleBlock>();
    for (const block of blocks.values()) {
        const inputs = block.inputs.map((input) => (hasIntInput(blocks, block, input.name, new Set()) ? { ...input, valueType: "int" } : input));
        let evaluatorClassName: string | undefined;
        if (block.customType === "BABYLON.ParticleMathBlock" && hasIntInput(blocks, block, "left", new Set())) {
            const left = block.inputs.find((input) => input.name.trim() === "left");
            const right = block.inputs.find((input) => input.name.trim() === "right");
            const alias = left?.targetBlockId === right?.targetBlockId && left?.targetConnectionName === right?.targetConnectionName;
            evaluatorClassName = alias ? "ParticleIntMathAliasBlock" : "ParticleIntMathBlock";
        }
        compiled.set(
            block.id,
            evaluatorClassName || inputs.some((input, index) => input !== block.inputs[index]) ? { ...block, inputs, _evaluatorClassName: evaluatorClassName } : block
        );
    }
    return compiled;
}
