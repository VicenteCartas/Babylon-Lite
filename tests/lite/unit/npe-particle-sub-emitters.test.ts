import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import { buildNodeParticleSet, type NodeParticleSet } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { compileNodeParticleGraph } from "../../../packages/babylon-lite/src/particle/node/npe-compiler";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import {
    animateParticleSystem,
    createParticleSystem,
    disposeParticleSystem,
    startParticleSystem,
    stopParticleSystem,
    type ParticleSystem,
} from "../../../packages/babylon-lite/src/particle/particle-system";
import { createNodeParticleChildHost } from "../../../packages/babylon-lite/src/particle/node/npe-sub-emitter-runtime";
import type { NodeParticleProgram } from "../../../packages/babylon-lite/src/particle/node/npe-types";
import { registerNodeParticleSet } from "../../../packages/babylon-lite/src/particle/particle-scene";
import type { Texture2D } from "../../../packages/babylon-lite/src/texture/texture-2d";
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

function particleBranch(firstId: number, capacity: number, systemInputs: RawInput[] = []): RawBlock[] {
    return [
        {
            customType: "BABYLON.CreateParticleBlock",
            id: firstId,
            inputs: [
                { name: "emitPower", valueType: "number", value: 1 },
                { name: "lifeTime", valueType: "number", value: 10 },
                { name: "color", valueType: "BABYLON.Color4", value: [1, 1, 1, 1] },
                { name: "colorDead", valueType: "BABYLON.Color4", value: [0, 0, 0, 0] },
                { name: "scale", valueType: "BABYLON.Vector2", value: [1, 1] },
                { name: "angle", valueType: "number", value: 0 },
                { name: "size", valueType: "number", value: 1 },
            ],
        },
        {
            customType: "BABYLON.PointShapeBlock",
            id: firstId + 1,
            inputs: [
                { name: "particle", targetBlockId: firstId, targetConnectionName: "particle" },
                { name: "direction1", valueType: "BABYLON.Vector3", value: [1, 0, 0] },
                { name: "direction2", valueType: "BABYLON.Vector3", value: [1, 0, 0] },
            ],
        },
        {
            customType: "BABYLON.SystemBlock",
            id: firstId + 2,
            capacity,
            manualEmitCount: 1,
            updateSpeed: 1,
            doNoStart: firstId >= 100,
            inputs: [{ name: "particle", targetBlockId: firstId + 1, targetConnectionName: "output" }, { name: "emitRate", valueType: "number", value: 0 }, ...systemInputs],
        },
    ];
}

async function compile(blocks: RawBlock[]): Promise<NodeParticleProgram> {
    return compileNodeParticleGraph(parseNodeParticleSource({ blocks }));
}

async function build(blocks: RawBlock[]): Promise<NodeParticleSet> {
    const program = await compile(blocks);
    return buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);
}

function triggerGraph(options: { count?: number; capacity?: number; limit?: number; delay?: number; condition?: number } = {}): RawBlock[] {
    const child = particleBranch(100, 3);
    const parent = particleBranch(1, options.capacity ?? 10);
    parent.at(-1)!.manualEmitCount = options.count ?? 1;
    const trigger: RawBlock = {
        customType: "BABYLON.ParticleTriggerBlock",
        id: 12,
        inputs: [
            { name: "input", targetBlockId: 2, targetConnectionName: "output" },
            { name: "condition", targetBlockId: 11, targetConnectionName: "output" },
            { name: "system", targetBlockId: 102, targetConnectionName: "system" },
        ],
    };
    if (options.limit !== undefined) {
        trigger.limit = options.limit;
    }
    if (options.delay !== undefined) {
        trigger.delay = options.delay;
    }
    parent.splice(
        2,
        0,
        {
            customType: "BABYLON.ParticleInputBlock",
            id: 11,
            name: "Trigger enabled",
            type: 0x0002,
            value: options.condition ?? 1,
            inputs: [],
        },
        trigger
    );
    parent.at(-1)!.inputs[0] = { name: "particle", targetBlockId: 12, targetConnectionName: "output" };
    return [...child, ...parent];
}

function findSystem(set: NodeParticleSet, capacity: number): ParticleSystem {
    return set.systems.find((system) => system.buffer.capacity === capacity)!;
}

function childSystems(set: NodeParticleSet): readonly ParticleSystem[] {
    return set._children!;
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("NPE sub-emitter systems", () => {
    it("triggers a fresh child at the current particle position and releases its active limit on disposal", async () => {
        vi.setSystemTime(1_000);
        const child = particleBranch(100, 3);
        const parent = particleBranch(1, 5);
        parent.splice(
            2,
            0,
            {
                customType: "BABYLON.BasicPositionUpdateBlock",
                id: 10,
                inputs: [{ name: "particle", targetBlockId: 2, targetConnectionName: "output" }],
            },
            {
                customType: "BABYLON.ParticleInputBlock",
                id: 11,
                name: "Trigger enabled",
                type: 0x0002,
                value: 1,
                inputs: [],
            },
            {
                customType: "BABYLON.ParticleTriggerBlock",
                id: 12,
                limit: 1,
                delay: 0,
                inputs: [
                    { name: "input", targetBlockId: 10, targetConnectionName: "output" },
                    { name: "condition", targetBlockId: 11, targetConnectionName: "output" },
                    { name: "system", targetBlockId: 102, targetConnectionName: "system" },
                ],
            }
        );
        (parent.at(-1)!.inputs[0] as RawInput) = { name: "particle", targetBlockId: 12, targetConnectionName: "output" };

        const set = await build([...child, ...parent]);
        const system = findSystem(set, 5);
        vi.spyOn(Math, "random").mockReturnValue(0.5);
        startParticleSystem(system);
        animateParticleSystem(system, 1);
        animateParticleSystem(system, 1);

        expect(childSystems(set)).toHaveLength(1);
        const first = childSystems(set)[0]!;
        expect(first._started).toBe(true);
        animateParticleSystem(first, 1);
        expect(Array.from(first.buffer.posX.subarray(0, first.buffer.alive))).toEqual([1]);

        animateParticleSystem(system, 1);
        expect(childSystems(set)).toEqual([first]);
        disposeParticleSystem(first);
        animateParticleSystem(system, 1);
        expect(childSystems(set)).toHaveLength(1);
        expect(childSystems(set)[0]).not.toBe(first);
    });

    it("creates one start and end child per run and recursively disposes them with the parent", async () => {
        const child = particleBranch(100, 3);
        const parent = particleBranch(1, 5, [
            { name: "onStart", targetBlockId: 102, targetConnectionName: "system" },
            { name: "onEnd", targetBlockId: 102, targetConnectionName: "system" },
        ]);
        const set = await build([...child, ...parent]);
        const system = findSystem(set, 5);

        stopParticleSystem(system);
        expect(childSystems(set)).toEqual([]);
        startParticleSystem(system);
        expect(childSystems(set)).toHaveLength(1);
        stopParticleSystem(system);
        stopParticleSystem(system);
        expect(childSystems(set)).toHaveLength(2);

        startParticleSystem(system);
        stopParticleSystem(system);
        expect(childSystems(set)).toHaveLength(4);
        expect(childSystems(set).every((entry) => entry._started)).toBe(true);

        const children = [...childSystems(set)];
        disposeParticleSystem(system);
        expect(childSystems(set)).toEqual([]);
        expect(children.every((entry) => entry._disposed)).toBe(true);
    });

    it("arms one end child for every accepted start notification", async () => {
        const child = particleBranch(100, 3);
        const parent = particleBranch(1, 5, [{ name: "onEnd", targetBlockId: 102, targetConnectionName: "system" }]);
        const set = await build([...child, ...parent]);
        const system = findSystem(set, 5);

        startParticleSystem(system);
        startParticleSystem(system);
        stopParticleSystem(system);
        stopParticleSystem(system);

        expect(childSystems(set)).toHaveLength(2);
    });

    it("applies the default global delay and explicit simultaneous-child limit", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const delayed = await build(triggerGraph({ count: 6 }));
        const delayedParent = findSystem(delayed, 10);
        startParticleSystem(delayedParent);
        animateParticleSystem(delayedParent, 1);
        animateParticleSystem(delayedParent, 1);
        expect(childSystems(delayed)).toHaveLength(1);

        vi.advanceTimersByTime(249);
        animateParticleSystem(delayedParent, 1);
        expect(childSystems(delayed)).toHaveLength(1);
        vi.advanceTimersByTime(1);
        animateParticleSystem(delayedParent, 1);
        expect(childSystems(delayed)).toHaveLength(2);

        const limited = await build(triggerGraph({ count: 6, delay: 0, limit: 5 }));
        const limitedParent = findSystem(limited, 10);
        startParticleSystem(limitedParent);
        animateParticleSystem(limitedParent, 1);
        animateParticleSystem(limitedParent, 1);
        expect(childSystems(limited)).toHaveLength(5);
    });

    it("accepts every nonzero condition and applies default, unlimited, and negative limits", async () => {
        const cases = [
            { options: { count: 6, delay: 0 }, expected: 5 },
            { options: { count: 6, delay: 0, limit: 0 }, expected: 6 },
            { options: { count: 6, delay: 0, limit: -1 }, expected: 0 },
            { options: { condition: 0, delay: 0, limit: 0 }, expected: 0 },
            { options: { condition: Number.NaN, delay: 0, limit: 0 }, expected: 1 },
        ];

        for (const { options, expected } of cases) {
            const set = await build(triggerGraph(options));
            const system = findSystem(set, 10);
            startParticleSystem(system);
            animateParticleSystem(system, 1);
            animateParticleSystem(system, 1);
            expect(childSystems(set)).toHaveLength(expected);
        }
    });

    it("triggers only for particles admitted by parent capacity", async () => {
        const set = await build(triggerGraph({ count: 6, capacity: 2, delay: 0, limit: 0 }));
        const system = findSystem(set, 2);
        startParticleSystem(system);
        animateParticleSystem(system, 1);
        animateParticleSystem(system, 1);

        expect(system.buffer.alive).toBe(2);
        expect(childSystems(set)).toHaveLength(2);
    });

    it("uses the current particle after swap-remove rather than stale dense-slot state", async () => {
        const set = await build(triggerGraph({ count: 2, delay: 0, limit: 0 }));
        const system = findSystem(set, 10);
        startParticleSystem(system);
        animateParticleSystem(system, 1);
        system.buffer.posX[0] = 10;
        system.buffer.posX[1] = 20;
        system.buffer.lifeTime[0] = 0.5;
        system.buffer.lifeTime[1] = 10;

        animateParticleSystem(system, 1);
        expect(childSystems(set)).toHaveLength(2);
        for (const child of childSystems(set)) {
            animateParticleSystem(child, 1);
        }
        expect(childSystems(set).map((child) => child.buffer.posX[0])).toEqual([10, 20]);
    });

    it("shares live input cells with existing and future child instances", async () => {
        const blocks = triggerGraph({ delay: 0, limit: 0 });
        const childCreate = blocks.find((block) => block.id === 100)!;
        blocks.unshift({ customType: "BABYLON.ParticleInputBlock", id: 150, name: "Child size", type: 0x0002, value: 1, inputs: [] });
        childCreate.inputs.find((input) => input.name === "size")!.targetBlockId = 150;
        childCreate.inputs.find((input) => input.name === "size")!.targetConnectionName = "output";
        const set = await build(blocks);
        const system = findSystem(set, 10);

        set.inputs["Child size"]!.value = 2.5;
        startParticleSystem(system);
        animateParticleSystem(system, 1);
        animateParticleSystem(system, 1);
        const first = childSystems(set)[0]!;
        animateParticleSystem(first, 1);
        expect(first.buffer.size[0]).toBe(2.5);

        set.inputs["Child size"]!.value = 0.25;
        disposeParticleSystem(first);
        animateParticleSystem(system, 1);
        const second = childSystems(set)[0]!;
        animateParticleSystem(second, 1);
        expect(second.buffer.size[0]).toBe(0.25);
    });

    it("isolates child hosts and buffers across builds of one reusable program", async () => {
        const program = await compile(triggerGraph({ delay: 0 }));
        const first = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);
        const second = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);
        for (const set of [first, second]) {
            const parent = findSystem(set, 10);
            startParticleSystem(parent);
            animateParticleSystem(parent, 1);
            animateParticleSystem(parent, 1);
        }

        expect(childSystems(first)).toHaveLength(1);
        expect(childSystems(second)).toHaveLength(1);
        expect(childSystems(first)).not.toBe(childSystems(second));
        expect(childSystems(first)[0]!.buffer).not.toBe(childSystems(second)[0]!.buffer);
    });

    it("supports nested lifecycle templates in the same set-local host", async () => {
        const grandchild = particleBranch(200, 2);
        const child = particleBranch(100, 3, [{ name: "onStart", targetBlockId: 202, targetConnectionName: "system" }]);
        const parent = particleBranch(1, 5, [{ name: "onStart", targetBlockId: 102, targetConnectionName: "system" }]);
        const set = await build([...grandchild, ...child, ...parent]);

        startParticleSystem(findSystem(set, 5));
        expect(childSystems(set).map((system) => system.buffer.capacity)).toEqual([3, 2]);
    });

    it("copies the lifecycle owner's emitter into each fresh child", async () => {
        const child = particleBranch(100, 3);
        const parent = particleBranch(1, 5, [{ name: "onStart", targetBlockId: 102, targetConnectionName: "system" }]);
        const program = await compile([...child, ...parent]);
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program, { emitter: { x: 3, y: -2, z: 4 } });

        startParticleSystem(findSystem(set, 5));
        const spawned = childSystems(set)[0]!;
        animateParticleSystem(spawned, 1);
        expect([spawned.buffer.posX[0], spawned.buffer.posY[0], spawned.buffer.posZ[0]]).toEqual([3, -2, 4]);
    });

    it("composes lifecycle hooks with dynamic emit rate and render-property variants", async () => {
        const child = particleBranch(100, 3);
        const parent = particleBranch(1, 5, [
            { name: "emitRate", targetBlockId: 20, targetConnectionName: "output" },
            { name: "onStart", targetBlockId: 102, targetConnectionName: "system" },
        ]);
        parent.unshift({ customType: "BABYLON.ParticleInputBlock", id: 20, type: 0x0002, value: 17, inputs: [] });
        parent.at(-1)!.inputs[1] = { name: "emitRate", targetBlockId: 20, targetConnectionName: "output" };
        parent.at(-1)!.renderingGroupId = 2;
        const set = await build([...child, ...parent]);
        const system = findSystem(set, 5);

        expect(system._emitRateGetter?.()).toBe(17);
        expect(system._registerBillboard).toBeDefined();
        startParticleSystem(system);
        expect(childSystems(set)).toHaveLength(1);
    });

    it("composes lifecycle hooks with specialized billboard modes", async () => {
        const child = particleBranch(100, 3);
        const parent = particleBranch(1, 5, [{ name: "onStart", targetBlockId: 102, targetConnectionName: "system" }]);
        parent.at(-1)!.billBoardMode = 2;
        const set = await build([...child, ...parent]);
        const system = findSystem(set, 5);

        expect(system._registerBillboard).toBeDefined();
        expect(system._syncBillboard).toBeDefined();
        startParticleSystem(system);
        expect(childSystems(set)).toHaveLength(1);
    });

    it("fires onEnd at target-duration stop rather than terminal drain", async () => {
        const child = particleBranch(100, 3);
        const parent = particleBranch(1, 5, [
            { name: "targetStopDuration", valueType: "number", value: 1 },
            { name: "onEnd", targetBlockId: 102, targetConnectionName: "system" },
        ]);
        const set = await build([...child, ...parent]);
        const system = findSystem(set, 5);

        startParticleSystem(system);
        animateParticleSystem(system, 1);
        expect(system._stopped).toBe(true);
        expect(system.buffer.alive).toBe(1);
        expect(childSystems(set)).toHaveLength(1);
    });

    it("disposes a child and releases ownership when asynchronous readiness fails", async () => {
        const owner = createParticleSystem(1);
        const child = createParticleSystem(1);
        const released = vi.fn();
        const host = createNodeParticleChildHost(() => ({ system: child, ready: Promise.reject(new Error("build failed")) }));

        expect(host.spawn(owner, [] as never, { x: 0, y: 0, z: 0 }, released)).toBe(child);
        expect(host.children).toEqual([child]);
        await vi.waitFor(() => expect(child._disposed).toBe(true));
        expect(host.children).toEqual([]);
        expect(released).toHaveBeenCalledOnce();
    });

    it("registers ready children once and removes their live callback on disposal", async () => {
        const parent = createParticleSystem(1);
        const child = createParticleSystem(1);
        const texture = { width: 1, height: 1 } as Texture2D;
        parent.texture = child.texture = texture;
        const unregisterParent = vi.fn();
        const unregisterChild = vi.fn();
        parent._registerBillboard = vi.fn(() => unregisterParent);
        child._registerBillboard = vi.fn(() => unregisterChild);
        let registerChild: ((instance: { system: ParticleSystem; ready: Promise<void> }) => void) | undefined;
        let resolveReady!: () => void;
        const ready = new Promise<void>((resolve) => (resolveReady = resolve));
        const disposeChildren = vi.fn();
        const set = {
            systems: [parent],
            inputs: {},
            _children: [child],
            _registerChildren: (register: (system: ParticleSystem) => void) => {
                registerChild = (instance) => void instance.ready.then(() => register(instance.system));
                return disposeChildren;
            },
        } satisfies NodeParticleSet;
        const scene = { _beforeRender: [], _disposables: [] } as unknown as SceneContext;

        registerNodeParticleSet(scene, set, { autoStart: false });
        expect(scene._beforeRender).toHaveLength(1);
        registerChild!({ system: child, ready });
        expect(scene._beforeRender).toHaveLength(1);
        resolveReady();
        await ready;
        await Promise.resolve();
        expect(scene._beforeRender).toHaveLength(2);
        expect(child._registerBillboard).toHaveBeenCalledOnce();

        disposeParticleSystem(child);
        expect(scene._beforeRender).toHaveLength(1);
        expect(unregisterChild).toHaveBeenCalledOnce();
        const retired = createParticleSystem(1);
        retired.texture = texture;
        retired._registerBillboard = vi.fn();
        let resolveRetired!: () => void;
        const retiredReady = new Promise<void>((resolve) => (resolveRetired = resolve));
        registerChild!({ system: retired, ready: retiredReady });
        disposeParticleSystem(retired);
        resolveRetired();
        await retiredReady;
        await Promise.resolve();
        expect(retired._registerBillboard).not.toHaveBeenCalled();
        expect(scene._beforeRender).toHaveLength(1);

        scene._disposables.at(-1)!();
        expect(scene._beforeRender).toHaveLength(0);
        expect(unregisterParent).toHaveBeenCalledOnce();
        expect(disposeChildren).toHaveBeenCalledOnce();
    });
});
