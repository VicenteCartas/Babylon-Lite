import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import { buildNodeParticleSet } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import {
    animateParticleSystem,
    createParticleSystem,
    startParticleSystem,
    stopParticleSystem,
    type ParticleSystem,
} from "../../../packages/babylon-lite/src/particle/particle-system";
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
    [field: string]: unknown;
}

function lifecycleGraph(systemFields: Record<string, unknown>, dynamicEmitRate = false): { blocks: RawBlock[] } {
    const systemInputs: RawInput[] = [
        { name: "particle", targetBlockId: 3, targetConnectionName: "output" },
        dynamicEmitRate ? { name: "emitRate", targetBlockId: 4, targetConnectionName: "output" } : { name: "emitRate", valueType: "number", value: 2 },
    ];
    const blocks: RawBlock[] = [
        {
            customType: "BABYLON.SystemBlock",
            id: 1,
            capacity: 10,
            updateSpeed: 0.25,
            inputs: systemInputs,
            ...systemFields,
        },
        {
            customType: "BABYLON.CreateParticleBlock",
            id: 2,
            inputs: [
                { name: "emitPower", valueType: "number", value: 1 },
                { name: "lifeTime", valueType: "number", value: 0.5 },
                { name: "color", valueType: "BABYLON.Color4", value: [1, 1, 1, 1] },
                { name: "colorDead", valueType: "BABYLON.Color4", value: [0, 0, 0, 0] },
                { name: "scale", valueType: "BABYLON.Vector2", value: [1, 1] },
                { name: "angle", valueType: "number", value: 0 },
                { name: "size", valueType: "number", value: 1 },
            ],
        },
        {
            customType: "BABYLON.PointShapeBlock",
            id: 3,
            inputs: [
                { name: "particle", targetBlockId: 2, targetConnectionName: "particle" },
                { name: "direction1", valueType: "BABYLON.Vector3", value: [0, 0, 0] },
                { name: "direction2", valueType: "BABYLON.Vector3", value: [1, 1, 1] },
            ],
        },
    ];
    if (dynamicEmitRate) {
        blocks.push({
            customType: "BABYLON.ParticleRandomBlock",
            id: 4,
            lockMode: 0,
            inputs: [
                { name: "min", valueType: "number", value: 20 },
                { name: "max", valueType: "number", value: 30 },
            ],
        });
    }
    return { blocks };
}

async function buildSystem(systemFields: Record<string, unknown> = {}, dynamicEmitRate = false): Promise<ParticleSystem> {
    const program = parseNodeParticleSource(lifecycleGraph(systemFields, dynamicEmitRate));
    const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);
    return set.systems[0]!;
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("NPE SystemBlock lifecycle properties", () => {
    it("defers start and then prewarms with the serialized step offset", async () => {
        vi.useFakeTimers();
        const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
        const system = await buildSystem({ updateSpeed: 0.5, preWarmCycles: 2, preWarmStepOffset: 2, startDelay: 25 });

        startParticleSystem(system);
        expect(system._started).toBe(false);
        expect(system.buffer.alive).toBe(0);
        expect(random).not.toHaveBeenCalled();

        vi.advanceTimersByTime(24);
        expect(system._started).toBe(false);
        vi.advanceTimersByTime(1);

        expect(system._started).toBe(true);
        expect(system.buffer._nextId).toBe(4);
        expect(system.buffer.alive).toBe(2);
        expect(Array.from(system.buffer.id.subarray(0, 2))).toEqual([2, 3]);
        expect(system._actualFrame).toBe(2);
        expect(random).toHaveBeenCalledTimes(12);
    });

    it("notifies start only after synchronous prewarm completes", async () => {
        const system = await buildSystem({ manualEmitCount: 1, preWarmCycles: 1, preWarmStepOffset: 1 });
        const onStart = vi.fn(() => expect(system.buffer.alive).toBe(1));
        const started = system._lifecycle!._started;
        system._lifecycle!._started = () => {
            started?.();
            onStart();
        };

        startParticleSystem(system);

        expect(onStart).toHaveBeenCalledOnce();
    });

    it("blocks starts while doNoStart is set", async () => {
        vi.useFakeTimers();
        const system = await buildSystem({ doNoStart: true, startDelay: 10, preWarmCycles: 1, preWarmStepOffset: 1 });

        startParticleSystem(system);
        expect(system._started).toBe(false);
        expect(vi.getTimerCount()).toBe(0);

        system.doNoStart = false;
        startParticleSystem(system);
        expect(vi.getTimerCount()).toBe(1);
        vi.advanceTimersByTime(10);
        expect(system._started).toBe(true);
    });

    it("emits a manual burst without evaluating emit rate, then drains and disposes once", async () => {
        const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
        const dispose = vi.fn();
        const system = await buildSystem({ manualEmitCount: 3, disposeOnStop: true }, true);
        const lifecycleDispose = system._lifecycle!._dispose;
        system._lifecycle!._dispose = () => {
            lifecycleDispose?.();
            dispose();
        };

        startParticleSystem(system);
        animateParticleSystem(system, 1);

        expect(system.buffer.alive).toBe(3);
        expect(system.manualEmitCount).toBe(0);
        expect(system._newPartsExcess).toBe(0);
        expect(system._stopped).toBe(true);
        expect(system._actualFrame).toBe(0.25);
        expect(random).toHaveBeenCalledTimes(9);

        animateParticleSystem(system, 1);
        expect(system.buffer.alive).toBe(3);
        expect(random).toHaveBeenCalledTimes(9);
        animateParticleSystem(system, 1);

        expect(system.buffer.alive).toBe(0);
        expect(system._started).toBe(false);
        expect(system._disposed).toBe(true);
        expect(dispose).toHaveBeenCalledTimes(1);

        animateParticleSystem(system, 1);
        startParticleSystem(system, 0);
        expect(dispose).toHaveBeenCalledTimes(1);
        expect(system._started).toBe(false);
    });

    it("becomes not-started after a non-disposing stopped system drains", async () => {
        const system = await buildSystem({ manualEmitCount: 1 });

        startParticleSystem(system);
        animateParticleSystem(system, 1);
        stopParticleSystem(system);
        animateParticleSystem(system, 1);
        animateParticleSystem(system, 1);

        expect(system.buffer.alive).toBe(0);
        expect(system._started).toBe(false);
        expect(system._disposed).toBe(false);
    });

    it("uses SystemBlock lifecycle defaults", async () => {
        const system = await buildSystem();

        expect(createParticleSystem(1).preWarmStepOffset).toBe(1);
        expect(system.manualEmitCount).toBe(-1);
        expect(system.preWarmCycles).toBe(0);
        expect(system.preWarmStepOffset).toBe(0);
        expect(system.startDelay).toBe(0);
        expect(system.disposeOnStop).toBe(false);
        expect(system.doNoStart).toBe(false);
    });
});
