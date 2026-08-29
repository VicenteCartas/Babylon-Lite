import type { CompiledParticleBlock, NodeParticleColumnRequirement } from "./npe-types.js";

/** @internal Compile sprite-sheet columns required by one system root. */
export function addNodeParticleSpriteResources(blocks: ReadonlyMap<number, CompiledParticleBlock>, systemBlockId: number, columns: NodeParticleColumnRequirement[]): void {
    let usesSpriteSheet = false;
    let usesRandomStart = false;
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
        if (block.className === "SetupSpriteSheetBlock") {
            usesSpriteSheet = true;
            usesRandomStart ||= block.serialized.randomStartCell === true;
        }
        for (const input of block.inputs) {
            if (input.targetBlockId !== null && input.targetConnectionName !== null) {
                visit(input.targetBlockId);
            }
        }
    };
    visit(systemBlockId);

    if (usesSpriteSheet) {
        columns.push({ name: "sprite.cellIndex", storage: "uint16" });
        if (usesRandomStart) {
            columns.push({ name: "sprite.randomOffset", storage: "float32" });
        }
    }
}
