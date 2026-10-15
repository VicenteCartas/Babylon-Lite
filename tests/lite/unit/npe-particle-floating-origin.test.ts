import { describe, expect, it } from "vitest";
import movingLocalGraph from "./fixtures/emitter-moving-local-npe.json";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { Mat4 } from "../../../packages/babylon-lite/src/math/types";
import { buildNodeParticleSet } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { compileNodeParticleGraph } from "../../../packages/babylon-lite/src/particle/node/npe-compiler";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import { animateParticleSystem, startParticleSystem, type ParticleSystem } from "../../../packages/babylon-lite/src/particle/particle-system";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";

interface RawInput {
    name: string;
    targetBlockId?: number;
    targetConnectionName?: string;
    value?: unknown;
}

interface RawBlock {
    customType: string;
    id: number;
    inputs: RawInput[];
    isLocal?: boolean;
    operation?: number;
    type?: number;
    contextualValue?: number;
    systemSource?: number;
}

interface RawGraph {
    blocks: RawBlock[];
}

const FAR_POSITION = 1_000_000;
const SUB_ULP_STEP = 0.0015;

function emitterMatrix64(x: number): Mat4 {
    return new Float64Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, 0, 1]) as unknown as Mat4;
}

function pointGraph(isLocal: boolean): RawGraph {
    const source = structuredClone(movingLocalGraph) as unknown as RawGraph;
    const system = source.blocks.find((block) => block.customType === "BABYLON.SystemBlock")!;
    const shape = source.blocks.find((block) => block.customType === "BABYLON.SphereShapeBlock")!;
    system.isLocal = isLocal;
    shape.customType = "BABYLON.PointShapeBlock";
    for (const input of shape.inputs) {
        if (input.name === "direction1" || input.name === "direction2") {
            input.value = [1, 0, 0];
        }
    }
    return source;
}

function worldIntegratedPointGraph(): RawGraph {
    const source = pointGraph(false);
    const updatePosition = source.blocks.find((block) => block.customType === "BABYLON.UpdatePositionBlock")!;
    const addPositionId = 6;
    const positionId = 7;
    const scaledDirectionId = 8;
    const position = updatePosition.inputs.find((input) => input.name === "position")!;
    position.targetBlockId = addPositionId;
    position.targetConnectionName = "output";
    source.blocks.push(
        {
            customType: "BABYLON.ParticleMathBlock",
            id: addPositionId,
            operation: 0,
            inputs: [
                { name: "left", targetBlockId: positionId, targetConnectionName: "output" },
                { name: "right", targetBlockId: scaledDirectionId, targetConnectionName: "output" },
            ],
        },
        { customType: "BABYLON.ParticleInputBlock", id: positionId, type: 8, contextualValue: 1, systemSource: 0, inputs: [] },
        { customType: "BABYLON.ParticleInputBlock", id: scaledDirectionId, type: 8, contextualValue: 6, systemSource: 0, inputs: [] }
    );
    return source;
}

async function buildSystem(source: RawGraph, engine: EngineContext, emitterX = FAR_POSITION): Promise<ParticleSystem> {
    const program = await compileNodeParticleGraph(parseNodeParticleSource(source));
    const set = await buildNodeParticleSet(engine, {} as SceneContext, program, { emitterWorldMatrix: emitterMatrix64(emitterX) });
    return set.systems[0]!;
}

function advanceIntegratedParticle(system: ParticleSystem): void {
    system.updateSpeed = SUB_ULP_STEP;
    system.emitRate = 1000;
    startParticleSystem(system);
    animateParticleSystem(system, 1);
    animateParticleSystem(system, 1);
}

describe("NPE floating-origin positions", () => {
    it("keeps ordinary systems on F32 and LWR world integration on F64", async () => {
        const source = worldIntegratedPointGraph();
        const ordinary = await buildSystem(source, {} as EngineContext);
        const lwr = await buildSystem(source, {
            useHighPrecisionMatrix: true,
            useFloatingOrigin: true,
        } as EngineContext);

        advanceIntegratedParticle(ordinary);
        advanceIntegratedParticle(lwr);

        expect(ordinary.buffer.posX).toBeInstanceOf(Float32Array);
        expect(ordinary.buffer.posX[0]).toBe(FAR_POSITION);
        expect(lwr.buffer.posX).toBeInstanceOf(Float64Array);
        expect(lwr.buffer.posX[0]! - FAR_POSITION).toBeCloseTo(SUB_ULP_STEP, 10);
        expect(lwr.buffer.posX.byteLength + lwr.buffer.posY.byteLength + lwr.buffer.posZ.byteLength).toBe(
            ordinary.buffer.posX.byteLength + ordinary.buffer.posY.byteLength + ordinary.buffer.posZ.byteLength + 12 * ordinary.buffer.capacity
        );
    });

    it("preserves a far LocalPositionUpdated projection without widening local state", async () => {
        const lwr = await buildSystem(
            pointGraph(true),
            {
                useHighPrecisionMatrix: true,
                useFloatingOrigin: true,
            } as EngineContext,
            FAR_POSITION + SUB_ULP_STEP
        );

        startParticleSystem(lwr);
        animateParticleSystem(lwr, 1);

        expect(lwr.buffer.posX[0]! - FAR_POSITION).toBeCloseTo(SUB_ULP_STEP, 10);
        expect(lwr.buffer.posX).toBeInstanceOf(Float64Array);
        expect(lwr.buffer.dirX).toBeInstanceOf(Float32Array);
        expect(lwr.buffer._columns.get("localPosition.x")).toBeInstanceOf(Float32Array);
    });
});
