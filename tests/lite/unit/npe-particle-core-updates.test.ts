import { describe, expect, it } from "vitest";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { Mat4 } from "../../../packages/babylon-lite/src/math/types";
import { buildNodeParticleSet } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import { animateParticleSystem, startParticleSystem, stopParticleSystem, type ParticleSystem } from "../../../packages/babylon-lite/src/particle/particle-system";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";

interface RawInput {
    name: string;
    targetBlockId?: number;
    targetConnectionName?: string;
    valueType?: string;
    value?: unknown;
}

interface RawBlock {
    customType: string;
    id: number;
    inputs: RawInput[];
    capacity?: number;
    updateSpeed?: number;
    isLocal?: boolean;
    type?: number;
    value?: unknown;
}

interface RawGraph {
    blocks: RawBlock[];
}

const FAR_POSITION = 1_000_000;

function emitterMatrix64(): Mat4 {
    return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, FAR_POSITION, 0, 0, 1]) as unknown as Mat4;
}

function createBlock(lifeTime: number): RawBlock {
    return {
        customType: "BABYLON.CreateParticleBlock",
        id: 2,
        inputs: [
            { name: "emitPower", valueType: "number", value: 1 },
            { name: "lifeTime", valueType: "number", value: lifeTime },
            { name: "color", valueType: "BABYLON.Color4", value: [0.01, 0.02, 0.03, 0.05] },
            { name: "colorDead", valueType: "BABYLON.Color4", value: [-1, -1, -1, -1] },
            { name: "scale", valueType: "BABYLON.Vector2", value: [1, 1] },
            { name: "angle", valueType: "number", value: 0 },
            { name: "size", valueType: "number", value: 1 },
        ],
    };
}

function pointBlock(): RawBlock {
    return {
        customType: "BABYLON.PointShapeBlock",
        id: 3,
        inputs: [
            { name: "particle", targetBlockId: 2, targetConnectionName: "particle" },
            { name: "direction1", valueType: "BABYLON.Vector3", value: [0.015, 0, 0] },
            { name: "direction2", valueType: "BABYLON.Vector3", value: [0.015, 0, 0] },
        ],
    };
}

function allCoreUpdatesGraph(): RawGraph {
    return {
        blocks: [
            {
                customType: "BABYLON.SystemBlock",
                id: 1,
                capacity: 1,
                updateSpeed: 0.1,
                isLocal: false,
                inputs: [
                    { name: "particle", targetBlockId: 7, targetConnectionName: "output" },
                    { name: "emitRate", valueType: "number", value: 10 },
                ],
            },
            createBlock(1),
            pointBlock(),
            { customType: "BABYLON.BasicPositionUpdateBlock", id: 4, inputs: [{ name: "particle", targetBlockId: 3, targetConnectionName: "output" }] },
            { customType: "BABYLON.BasicColorUpdateBlock", id: 5, inputs: [{ name: "particle", targetBlockId: 4, targetConnectionName: "output" }] },
            {
                customType: "BABYLON.UpdateScaleBlock",
                id: 6,
                inputs: [
                    { name: "particle", targetBlockId: 5, targetConnectionName: "output" },
                    { name: "scale", targetBlockId: 8, targetConnectionName: "output" },
                ],
            },
            {
                customType: "BABYLON.UpdateAgeBlock",
                id: 7,
                inputs: [
                    { name: "particle", targetBlockId: 6, targetConnectionName: "output" },
                    { name: "age", targetBlockId: 9, targetConnectionName: "output" },
                ],
            },
            { customType: "BABYLON.ParticleInputBlock", id: 8, type: 4, inputs: [], value: [2, 3] },
            { customType: "BABYLON.ParticleInputBlock", id: 9, type: 2, inputs: [], value: 0.4 },
        ],
    };
}

function dyingParticleGraph(): RawGraph {
    return {
        blocks: [
            {
                customType: "BABYLON.SystemBlock",
                id: 1,
                capacity: 1,
                updateSpeed: 0.1,
                isLocal: false,
                inputs: [
                    { name: "particle", targetBlockId: 5, targetConnectionName: "output" },
                    { name: "emitRate", valueType: "number", value: 10 },
                ],
            },
            createBlock(0.15),
            pointBlock(),
            { customType: "BABYLON.BasicPositionUpdateBlock", id: 4, inputs: [{ name: "particle", targetBlockId: 3, targetConnectionName: "output" }] },
            { customType: "BABYLON.BasicColorUpdateBlock", id: 5, inputs: [{ name: "particle", targetBlockId: 4, targetConnectionName: "output" }] },
        ],
    };
}

async function buildLwrSystem(source: RawGraph): Promise<ParticleSystem> {
    const engine = { useFloatingOrigin: true } as EngineContext;
    const program = parseNodeParticleSource(source);
    const set = await buildNodeParticleSet(engine, {} as SceneContext, program, { emitterWorldMatrix: emitterMatrix64() });
    return set.systems[0]!;
}

describe("NPE core update blocks", () => {
    it("executes all four blocks in one compiled update chain", async () => {
        const system = await buildLwrSystem(allCoreUpdatesGraph());

        startParticleSystem(system);
        animateParticleSystem(system, 1);
        animateParticleSystem(system, 1);

        expect(system.buffer.posX).toBeInstanceOf(Float64Array);
        expect(system.buffer.posX[0]! - FAR_POSITION).toBeCloseTo(0.0015, 10);
        expect(system.buffer.scaleX[0]).toBe(2);
        expect(system.buffer.scaleY[0]).toBe(3);
        expect(system.buffer.age[0]).toBe(0.4);
        expect(system.buffer.colorR[0]).toBeCloseTo(-0.091, 6);
        expect(system.buffer.colorG[0]).toBeCloseTo(-0.082, 6);
        expect(system.buffer.colorB[0]).toBeCloseTo(-0.073, 6);
        expect(system.buffer.colorA[0]).toBe(0);
    });

    it("clamps only position integration to the particle lifetime", async () => {
        const system = await buildLwrSystem(dyingParticleGraph());

        startParticleSystem(system);
        animateParticleSystem(system, 1);
        animateParticleSystem(system, 1);
        stopParticleSystem(system);
        animateParticleSystem(system, 1);

        expect(system.buffer.alive).toBe(0);
        expect(system.buffer.posX[0]! - FAR_POSITION).toBeCloseTo(0.00225, 10);
        expect(system.buffer.colorR[0]).toBeCloseTo(-1.3366667, 6);
    });
});
