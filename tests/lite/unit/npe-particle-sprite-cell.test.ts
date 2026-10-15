import { describe, expect, it } from "vitest";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import { buildNodeParticleSet, compileNodeParticleGraph } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import type { ParticleSystem } from "../../../packages/babylon-lite/src/particle/particle-system";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";

const SPRITE_CELL_INDEX = 0x0010;
const SPRITE_CELL_START = 0x0011;
const SPRITE_CELL_END = 0x0012;

async function buildSystem(blocks: object[]): Promise<ParticleSystem> {
    const program = await compileNodeParticleGraph(parseNodeParticleSource({ blocks }));
    return (await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program)).systems[0]!;
}

function updateGraph(cellIndexBlock: object, withSetup = false): object[] {
    const particleBlockId = withSetup ? 3 : 2;
    return [
        cellIndexBlock,
        { customType: "BABYLON.CreateParticleBlock", id: 2, inputs: [] },
        ...(withSetup
            ? [
                  {
                      customType: "BABYLON.SetupSpriteSheetBlock",
                      id: 3,
                      start: 3,
                      end: 7,
                      inputs: [{ name: "particle", targetBlockId: 2, targetConnectionName: "particle" }],
                  },
              ]
            : []),
        {
            customType: "BABYLON.UpdateSpriteCellIndexBlock",
            id: 4,
            inputs: [
                { name: "particle", targetBlockId: particleBlockId, targetConnectionName: "output" },
                { name: "cellIndex", targetBlockId: 1, targetConnectionName: "output" },
            ],
        },
        { customType: "BABYLON.SystemBlock", id: 5, inputs: [{ name: "particle", targetBlockId: 4, targetConnectionName: "output" }] },
    ];
}

describe("NPE Stage 5 sprite-cell values", () => {
    it("allocates and floors the cell-index column without SetupSpriteSheetBlock", async () => {
        const system = await buildSystem(updateGraph({ customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 4.9, inputs: [] }));
        const cellIndex = system.buffer._columns.get("sprite.cellIndex");

        expect(system._spriteSheet).toBeUndefined();
        expect(cellIndex).toBeInstanceOf(Uint16Array);
        expect(system.updateSteps).toHaveLength(1);
        system.updateSteps[0]!(0);
        expect(cellIndex![0]).toBe(4);
    });

    it.each([
        ["10", SPRITE_CELL_INDEX, 5],
        ["11", SPRITE_CELL_START, 3],
        ["12", SPRITE_CELL_END, 7],
    ])("resolves contextual source 0x%s through shared sprite state", async (_hex, source, expected) => {
        const system = await buildSystem(updateGraph({ customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0001, contextualValue: source, inputs: [] }, true));
        const cellIndex = system.buffer._columns.get("sprite.cellIndex")!;
        cellIndex[0] = 5;

        expect(system._spriteSheet!.cellIndex).toBe(cellIndex);
        system.updateSteps[0]!(0);
        expect(cellIndex[0]).toBe(expected);
    });

    it("leaves storage and update steps absent when cellIndex is disconnected", async () => {
        const blocks = updateGraph({ customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 2, inputs: [] });
        const update = blocks.find((block) => (block as { id?: number }).id === 4) as { inputs: object[] };
        update.inputs.pop();
        const system = await buildSystem(blocks);

        expect(system.buffer._columns.has("sprite.cellIndex")).toBe(false);
        expect(system.updateSteps).toHaveLength(0);
    });

    it("runs after BasicSpriteUpdateBlock when appended later in the particle chain", async () => {
        const blocks = updateGraph({ customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 2.9, inputs: [] }, true);
        const update = blocks.find((block) => (block as { id?: number }).id === 4) as { inputs: Array<{ name: string; targetBlockId?: number }> };
        blocks.splice(3, 0, {
            customType: "BABYLON.BasicSpriteUpdateBlock",
            id: 6,
            inputs: [{ name: "particle", targetBlockId: 3, targetConnectionName: "output" }],
        });
        update.inputs[0]!.targetBlockId = 6;
        const system = await buildSystem(blocks);
        const cellIndex = system._spriteSheet!.cellIndex;
        system.buffer.age[0] = 0.5;
        system.buffer.lifeTime[0] = 1;

        expect(system.updateSteps).toHaveLength(2);
        system.updateSteps[0]!(0);
        expect(cellIndex[0]).toBe(5);
        system.updateSteps[1]!(0);
        expect(cellIndex[0]).toBe(2);
    });

    it("retains Int propagation when a sprite-cell source reaches ParticleMathBlock", async () => {
        const system = await buildSystem([
            { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0001, contextualValue: SPRITE_CELL_INDEX, inputs: [] },
            { customType: "BABYLON.ParticleInputBlock", id: 2, type: 0x0002, value: 0.5, inputs: [] },
            {
                customType: "BABYLON.ParticleMathBlock",
                id: 3,
                inputs: [
                    { name: "left", targetBlockId: 1, targetConnectionName: "output" },
                    { name: "right", targetBlockId: 2, targetConnectionName: "output" },
                ],
            },
            { customType: "BABYLON.CreateParticleBlock", id: 4, inputs: [] },
            { customType: "BABYLON.SetupSpriteSheetBlock", id: 5, inputs: [{ name: "particle", targetBlockId: 4, targetConnectionName: "particle" }] },
            {
                customType: "BABYLON.SystemBlock",
                id: 6,
                inputs: [
                    { name: "particle", targetBlockId: 5, targetConnectionName: "output" },
                    { name: "emitRate", targetBlockId: 3, targetConnectionName: "output" },
                ],
            },
        ]);
        system._spriteSheet!.cellIndex[0] = 5;

        expect(system._emitRateGetter!()).toBe(5);
    });
});
