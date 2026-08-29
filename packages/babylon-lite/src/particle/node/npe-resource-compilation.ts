import type { CompiledParticleBlock, NodeParticleColumnRequirement, NodeParticleColumnStorage } from "./npe-types.js";

function reachableBlocks(blocks: ReadonlyMap<number, CompiledParticleBlock>, systemBlockId: number): CompiledParticleBlock[] {
    const reachable: CompiledParticleBlock[] = [];
    const visited = new Set<number>();
    const visit = (blockId: number): void => {
        if (visited.has(blockId)) {
            return;
        }
        visited.add(blockId);
        const block = blocks.get(blockId);
        if (!block) {
            return;
        }
        reachable.push(block);
        for (const input of block.inputs) {
            if (input.targetBlockId !== null && input.targetConnectionName !== null) {
                visit(input.targetBlockId);
            }
        }
    };
    visit(systemBlockId);
    return reachable;
}

function suppressesInitialDirectionCapture(block: CompiledParticleBlock): boolean {
    if (block.className !== "MeshShapeBlock" || block.serialized.useMeshNormalsForDirection === false) {
        return false;
    }
    const cachedVertexData = block.serialized.cachedVertexData as { normals?: unknown } | undefined;
    return Array.isArray(cachedVertexData?.normals);
}

/** @internal Compile the optional particle columns required by one system root. */
export function compileNodeParticleResources(blocks: ReadonlyMap<number, CompiledParticleBlock>, systemBlockId: number): NodeParticleColumnRequirement[] {
    const reachable = reachableBlocks(blocks, systemBlockId);
    const requirements = new Map<string, NodeParticleColumnStorage>();
    const add = (name: string, storage: NodeParticleColumnStorage): void => {
        const existing = requirements.get(name);
        if (existing && existing !== storage) {
            throw new Error(`NodeParticle: column "${name}" requires both ${existing} and ${storage} storage`);
        }
        requirements.set(name, storage);
    };
    const addComponents = (prefix: string, names: readonly string[], storage: NodeParticleColumnStorage): void => {
        for (const name of names) {
            add(`${prefix}${name}`, storage);
        }
    };
    const suppressInitialDirection = reachable.some(suppressesInitialDirectionCapture);

    for (const block of reachable) {
        if (block.className === "ParticleInputBlock") {
            switch (block.serialized.contextualValue) {
                case 0x0013:
                    addComponents("initialColor.", ["r", "g", "b", "a"], "float32");
                    break;
                case 0x0014:
                    addComponents("colorDead.", ["r", "g", "b", "a"], "float32");
                    break;
                case 0x0015:
                    if (!suppressInitialDirection) {
                        addComponents("initialDir.", ["x", "y", "z"], "float32");
                    }
                    break;
                case 0x0018:
                    addComponents("localPosition.", ["x", "y", "z"], "float32");
                    add("localPosition.id", "uint32");
                    add("localPosition.valid", "uint8");
                    break;
            }
            continue;
        }

        if (block.className === "ParticleRandomBlock" && block.serialized.lockMode === 3) {
            const prefix = `random.${block.id}.`;
            const valueType = block.inputs.find((input) => input.name === "min")?.valueType ?? block.inputs.find((input) => input.name === "max")?.valueType ?? "number";
            const components = valueType === "BABYLON.Color4" ? 4 : valueType === "BABYLON.Vector3" ? 3 : valueType[0] === "B" ? 2 : 1;
            add(`${prefix}id`, "uint32");
            add(`${prefix}valid`, "uint8");
            for (let component = 0; component < components; component++) {
                add(`${prefix}value${component}`, "float64");
            }
            continue;
        }

        if (block.className === "ParticleLocalVariableBlock" && block.serialized.scope === 0) {
            const prefix = `local.${block.id}.`;
            add(`${prefix}id`, "uint32");
            add(`${prefix}valid`, "uint8");
            for (let component = 0; component < 4; component++) {
                add(`${prefix}value${component}`, "float64");
            }
            continue;
        }

        if (block.className === "UpdateNoiseBlock") {
            addComponents("noise.coord1.", ["x", "y", "z"], "float64");
            addComponents("noise.coord2.", ["x", "y", "z"], "float64");
            add("noise.id", "uint32");
            add("noise.valid", "uint8");
        }
    }

    const columns: NodeParticleColumnRequirement[] = Array.from(requirements, ([name, storage]) => ({ name, storage }));
    columns.sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
    return columns;
}
