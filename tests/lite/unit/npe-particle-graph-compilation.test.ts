import { afterEach, describe, expect, it, vi } from "vitest";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import { createIdentityMat4 } from "../../../packages/babylon-lite/src/math/create-identity-mat4";
import { buildNodeParticleSet, instantiateNodeParticleSystem } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { buildNodeParticleSetWithBlendModes } from "../../../packages/babylon-lite/src/particle/node/npe-blend-modes";
import { buildNodeParticleSetWithEmitterProvider } from "../../../packages/babylon-lite/src/particle/node/npe-emitter-provider";
import { buildNodeParticleSetWithFlowMaps } from "../../../packages/babylon-lite/src/particle/node/npe-flow-map";
import { compileNodeParticleGraph } from "../../../packages/babylon-lite/src/particle/node/npe-compiler";
import { buildNodeParticleSetWithNoiseTextures } from "../../../packages/babylon-lite/src/particle/node/npe-noise";
import { parseNodeParticleSetFromSnippet } from "../../../packages/babylon-lite/src/particle/node/node-particle";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import { buildNodeParticleSetWithTextureUpdates } from "../../../packages/babylon-lite/src/particle/node/npe-texture-updates";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";

interface GraphSource {
    blocks: Array<Record<string, unknown>>;
}

function localGraph(scope: unknown, useParticle: boolean, useSystem: boolean): GraphSource {
    const blocks: GraphSource["blocks"] = [
        { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 7, inputs: [] },
        {
            customType: "BABYLON.ParticleLocalVariableBlock",
            id: 2,
            ...(scope === undefined ? {} : { scope }),
            inputs: [{ name: "input", targetBlockId: 1, targetConnectionName: "output" }],
        },
    ];
    const systemInputs: Array<Record<string, unknown>> = [];
    if (useParticle) {
        blocks.push({
            customType: "BABYLON.CreateParticleBlock",
            id: 3,
            inputs: [{ name: "lifeTime", targetBlockId: 2, targetConnectionName: "output" }],
        });
        systemInputs.push({ name: "particle", targetBlockId: 3, targetConnectionName: "particle" });
    }
    if (useSystem) {
        systemInputs.push({ name: "targetStopDuration", targetBlockId: 2, targetConnectionName: "output" });
    }
    blocks.push({ customType: "BABYLON.SystemBlock", id: 4, capacity: 2, inputs: systemInputs });
    return { blocks };
}

function passThroughSource(className: "ParticleElbowBlock" | "ParticleDebugBlock", stackSize?: number): GraphSource {
    return {
        blocks: [
            { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 7, inputs: [] },
            {
                customType: `BABYLON.${className}`,
                id: 2,
                ...(stackSize === undefined ? {} : { stackSize }),
                inputs: [{ name: "input", targetBlockId: 1, targetConnectionName: "output" }],
            },
            { customType: "BABYLON.SystemBlock", id: 3, inputs: [{ name: "targetStopDuration", targetBlockId: 2, targetConnectionName: "output" }] },
        ],
    };
}

function unsupportedRoleSource(className: "ParticleDebugBlock" | "ParticleLocalVariableBlock", role: string): GraphSource {
    const sourceBlock =
        role === "particle flow"
            ? { customType: "BABYLON.CreateParticleBlock", id: 1, inputs: [] }
            : role === "texture"
              ? { customType: "BABYLON.ParticleTextureSourceBlock", id: 1, inputs: [] }
              : { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 1, inputs: [] };
    const proxy = {
        customType: `BABYLON.${className}`,
        id: 2,
        scope: 1,
        inputs: [{ name: "input", targetBlockId: 1, targetConnectionName: role === "particle flow" ? "particle" : role === "texture" ? "texture" : "output" }],
    };
    if (role === "gradient metadata") {
        return {
            blocks: [
                sourceBlock,
                proxy,
                { customType: "BABYLON.ParticleGradientBlock", id: 3, inputs: [{ name: "value0", targetBlockId: 2, targetConnectionName: "output" }] },
                { customType: "BABYLON.SystemBlock", id: 4, inputs: [{ name: "targetStopDuration", targetBlockId: 3, targetConnectionName: "output" }] },
            ],
        };
    }
    return {
        blocks: [
            sourceBlock,
            proxy,
            {
                customType: "BABYLON.SystemBlock",
                id: 3,
                inputs: [
                    {
                        name: role === "particle flow" ? "particle" : role === "system flow" ? "onStart" : "texture",
                        targetBlockId: 2,
                        targetConnectionName: "output",
                    },
                ],
            },
        ],
    };
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("NPE graph compilation", () => {
    it("accepts Particle scope only on a particle-only domain", async () => {
        const program = await compileNodeParticleGraph(parseNodeParticleSource(localGraph(0, true, false)));
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);

        expect(set.systems[0]!.buffer._columns.size).toBe(6);
        expect(set.systems[0]!.buffer._columns.get("local.2.id")).toBeInstanceOf(Uint32Array);
        expect(set.systems[0]!.buffer._columns.get("local.2.valid")).toBeInstanceOf(Uint8Array);
        expect(set.systems[0]!.buffer._columns.get("local.2.value0")).toBeInstanceOf(Float64Array);
    });

    it("declares sprite-sheet columns only for the system that reaches them", async () => {
        const program = await compileNodeParticleGraph(
            parseNodeParticleSource({
                blocks: [
                    { customType: "BABYLON.CreateParticleBlock", id: 1, inputs: [] },
                    {
                        customType: "BABYLON.SetupSpriteSheetBlock",
                        id: 2,
                        randomStartCell: true,
                        inputs: [{ name: "particle", targetBlockId: 1, targetConnectionName: "particle" }],
                    },
                    { customType: "BABYLON.SystemBlock", id: 3, inputs: [{ name: "particle", targetBlockId: 2, targetConnectionName: "output" }] },
                    { customType: "BABYLON.CreateParticleBlock", id: 4, inputs: [] },
                    { customType: "BABYLON.SystemBlock", id: 5, inputs: [{ name: "particle", targetBlockId: 4, targetConnectionName: "particle" }] },
                ],
            })
        );
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);

        expect(set.systems[0]!.buffer._columns.size).toBe(2);
        expect(set.systems[0]!.buffer._columns.get("sprite.cellIndex")).toBeInstanceOf(Uint16Array);
        expect(set.systems[0]!.buffer._columns.get("sprite.randomOffset")).toBeInstanceOf(Float32Array);
        expect(set.systems[1]!.buffer._columns.size).toBe(0);
    });

    it.each([
        ["system-only", false, true],
        ["shared particle and system", true, true],
    ])("rejects Particle scope on a %s domain", async (_name, useParticle, useSystem) => {
        await expect(compileNodeParticleGraph(parseNodeParticleSource(localGraph(0, useParticle, useSystem)))).rejects.toThrow(
            "NodeParticle: ParticleLocalVariableBlock 2 Particle scope requires particle-only evaluation"
        );
    });

    it.each([
        ["particle", true, false, 1],
        ["system", false, true, 1],
        ["shared", true, true, 1],
        ["missing scope", false, true, undefined],
    ] as Array<[string, boolean, boolean, unknown]>)("accepts Loop scope on the %s domain", async (_name, useParticle, useSystem, scope) => {
        const program = await compileNodeParticleGraph(parseNodeParticleSource(localGraph(scope, useParticle, useSystem)));
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);

        expect(set.systems).toHaveLength(1);
        expect(set.systems[0]!._prepareFrame).toEqual(expect.any(Function));
        expect(set.systems[0]!.buffer._columns.size).toBe(0);
    });

    it.each([
        ["ParticleElbowBlock", undefined],
        ["ParticleDebugBlock", 37],
    ] as const)("compiles away %s on an NpeValue route", async (className, stackSize) => {
        const source = passThroughSource(className, stackSize);
        const snapshot = structuredClone(source);
        const program = await compileNodeParticleGraph(parseNodeParticleSource(source));
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);

        expect(set.systems[0]!.targetStopDuration).toBe(7);
        expect(source).toEqual(snapshot);
    });

    it("routes every opaque connection role through Elbow", async () => {
        const source: GraphSource = {
            blocks: [
                { customType: "BABYLON.CreateParticleBlock", id: 1, inputs: [] },
                { customType: "BABYLON.ParticleTextureSourceBlock", id: 2, inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 3, type: 0x0002, value: 1, inputs: [] },
                { customType: "BABYLON.ParticleElbowBlock", id: 10, inputs: [{ name: "input", targetBlockId: 1, targetConnectionName: "particle" }] },
                { customType: "BABYLON.ParticleElbowBlock", id: 11, inputs: [{ name: "input", targetBlockId: 3, targetConnectionName: "output" }] },
                { customType: "BABYLON.ParticleElbowBlock", id: 12, inputs: [{ name: "input", targetBlockId: 2, targetConnectionName: "texture" }] },
                { customType: "BABYLON.ParticleElbowBlock", id: 13, inputs: [{ name: "input", targetBlockId: 3, targetConnectionName: "output" }] },
                { customType: "BABYLON.ParticleGradientBlock", id: 20, inputs: [{ name: "value0", targetBlockId: 13, targetConnectionName: "output" }] },
                {
                    customType: "BABYLON.SystemBlock",
                    id: 30,
                    inputs: [
                        { name: "particle", targetBlockId: 10, targetConnectionName: "output" },
                        { name: "onStart", targetBlockId: 11, targetConnectionName: "output" },
                        { name: "texture", targetBlockId: 12, targetConnectionName: "output" },
                        { name: "targetStopDuration", targetBlockId: 20, targetConnectionName: "output" },
                    ],
                },
            ],
        };
        const program = await compileNodeParticleGraph(parseNodeParticleSource(source));

        expect(program._systems).toHaveLength(1);
    });

    it("compiles connected systems as reusable child plans without inlining them", async () => {
        const program = await compileNodeParticleGraph(
            parseNodeParticleSource({
                blocks: [
                    { customType: "BABYLON.CreateParticleBlock", id: 1, inputs: [] },
                    { customType: "BABYLON.SystemBlock", id: 2, capacity: 3, inputs: [{ name: "particle", targetBlockId: 1, targetConnectionName: "particle" }] },
                    { customType: "BABYLON.CreateParticleBlock", id: 3, inputs: [] },
                    { customType: "BABYLON.ParticleElbowBlock", id: 5, inputs: [{ name: "input", targetBlockId: 2, targetConnectionName: "system" }] },
                    {
                        customType: "BABYLON.SystemBlock",
                        id: 4,
                        capacity: 5,
                        inputs: [
                            { name: "particle", targetBlockId: 3, targetConnectionName: "particle" },
                            { name: "onStart", targetBlockId: 2, targetConnectionName: "system" },
                            { name: "onEnd", targetBlockId: 5, targetConnectionName: "output" },
                        ],
                    },
                ],
            })
        );
        const childPlan = program._systems.find((operations) => (operations[operations.length - 2] as { id: number }).id === 2)!;
        const parentPlan = program._systems.find((operations) => (operations[operations.length - 2] as { id: number }).id === 4)!;
        const parentBlock = parentPlan[parentPlan.length - 2] as { _systemPlans?: Record<string, unknown> };

        expect(parentBlock._systemPlans?.onStart).toBe(childPlan);
        expect(parentBlock._systemPlans?.onEnd).toBe(childPlan);
        expect(parentPlan.filter((operation) => "id" in operation).map((operation) => operation.id)).toEqual([3, 4]);

        const first = await instantiateNodeParticleSystem({} as EngineContext, {} as SceneContext, childPlan);
        const second = await instantiateNodeParticleSystem({} as EngineContext, {} as SceneContext, childPlan);
        expect(first.buffer.capacity).toBe(3);
        expect(second.buffer).not.toBe(first.buffer);
    });

    it.each([
        ["ParticleElbowBlock", 10, "elbowValue"],
        ["ParticleDebugBlock", 11, "debugValue"],
        ["ParticleLocalVariableBlock", 12, "localValue"],
    ] as const)("rejects a non-output reference to %s", async (className, id, badName) => {
        const source: GraphSource = {
            blocks: [
                { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 1, inputs: [] },
                {
                    customType: `BABYLON.${className}`,
                    id,
                    ...(className === "ParticleLocalVariableBlock" ? { scope: 1 } : {}),
                    inputs: [{ name: "input", targetBlockId: 1, targetConnectionName: "output" }],
                },
                { customType: "BABYLON.SystemBlock", id: 20, inputs: [{ name: "targetStopDuration", targetBlockId: id, targetConnectionName: badName }] },
            ],
        };

        await expect(compileNodeParticleGraph(parseNodeParticleSource(source))).rejects.toThrowError(
            new Error(`NodeParticle: ${className} ${id} does not expose output "${badName}"`)
        );
    });

    it.each(["ParticleDebugBlock", "ParticleLocalVariableBlock"] as const)("rejects every unsupported connection role for %s", async (className) => {
        for (const role of ["particle flow", "system flow", "texture", "gradient metadata"]) {
            await expect(compileNodeParticleGraph(parseNodeParticleSource(unsupportedRoleSource(className, role)))).rejects.toThrow(
                `NodeParticle: ${className} 2 does not support ${role} connections`
            );
        }
    });

    it.each(["ParticleElbowBlock", "ParticleDebugBlock", "ParticleLocalVariableBlock"] as const)("rejects a disconnected reachable %s", async (className) => {
        const source = passThroughSource(className === "ParticleLocalVariableBlock" ? "ParticleDebugBlock" : className);
        source.blocks[1] = { customType: `BABYLON.${className}`, id: 2, scope: 1, inputs: [{ name: "input", targetBlockId: 1 }] };

        await expect(compileNodeParticleGraph(parseNodeParticleSource(source))).rejects.toThrow(`NodeParticle: ${className} 2 input is not connected`);
    });

    it("reports one deterministic cycle across Elbow, Debug, and Teleport", async () => {
        const source: GraphSource = {
            blocks: [
                { customType: "BABYLON.ParticleElbowBlock", id: 2, inputs: [{ name: "input", targetBlockId: 3, targetConnectionName: "output" }] },
                { customType: "BABYLON.ParticleDebugBlock", id: 3, inputs: [{ name: "input", targetBlockId: 4, targetConnectionName: "output" }] },
                { customType: "BABYLON.ParticleTeleportOutBlock", id: 4, entryPoint: 5, inputs: [] },
                { customType: "BABYLON.ParticleTeleportInBlock", id: 5, inputs: [{ name: "input", targetBlockId: 2, targetConnectionName: "output" }] },
                { customType: "BABYLON.SystemBlock", id: 6, inputs: [{ name: "targetStopDuration", targetBlockId: 2, targetConnectionName: "output" }] },
            ],
        };

        await expect(compileNodeParticleGraph(parseNodeParticleSource(source))).rejects.toThrow("NodeParticle: graph plumbing cycle 2 -> 3 -> 4 -> 5 -> 2");
    });

    it("shares detached malformed graph-plumbing candidates without diagnosing them", async () => {
        const graph = parseNodeParticleSource({
            blocks: [
                { customType: "BABYLON.SystemBlock", id: 1, inputs: [] },
                { customType: "BABYLON.ParticleElbowBlock", id: 2, inputs: [] },
                { customType: "BABYLON.ParticleDebugBlock", id: 3, inputs: [] },
                { customType: "BABYLON.ParticleLocalVariableBlock", id: 4, scope: 0, inputs: [] },
            ],
        });
        const program = await compileNodeParticleGraph(graph);

        expect(program).not.toBe(graph);
        expect(program._systems).toHaveLength(1);
        expect((program._systems[0]?.[0] as { id: number }).id).toBe(1);
        expect(program._systems[0]).toHaveLength(2);
    });

    it.each([
        ["default", buildNodeParticleSet],
        ["flow-map", buildNodeParticleSetWithFlowMaps],
        ["noise", buildNodeParticleSetWithNoiseTextures],
        ["combined texture-update", buildNodeParticleSetWithTextureUpdates],
        ["blend", buildNodeParticleSetWithBlendModes],
    ] as const)("builds one program LocalVariable graph through the %s family", async (_name, builder) => {
        const graph = await compileNodeParticleGraph(parseNodeParticleSource(localGraph(1, false, true)));
        const set = await builder({} as EngineContext, {} as SceneContext, graph);

        expect(set.systems[0]!.targetStopDuration).toBe(7);
    });

    it("builds a program LocalVariable graph with an emitter provider", async () => {
        const graph = await compileNodeParticleGraph(parseNodeParticleSource(localGraph(1, false, true)));
        const set = await buildNodeParticleSetWithEmitterProvider({} as EngineContext, {} as SceneContext, graph, () => createIdentityMat4());

        expect(set.systems[0]!.targetStopDuration).toBe(7);
    });

    it("compiles LocalVariable through inline and fetched snippet boundaries", async () => {
        const inline = await parseNodeParticleSetFromSnippet({} as EngineContext, {} as SceneContext, "", { json: localGraph(1, false, true) });
        const source = localGraph(1, false, true);
        const fetchMock = vi.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ jsonPayload: JSON.stringify({ nodeParticle: JSON.stringify(source) }) }),
        }));
        vi.stubGlobal("fetch", fetchMock);
        const fetched = await parseNodeParticleSetFromSnippet({} as EngineContext, {} as SceneContext, "LOCAL#1", { snippetServer: "https://snippets.invalid" });

        expect(inline.systems[0]!.targetStopDuration).toBe(7);
        expect(fetched.systems[0]!.targetStopDuration).toBe(7);
    });

    it("compiles pass-through blocks before instantiation", async () => {
        const graph = parseNodeParticleSource(passThroughSource("ParticleElbowBlock"));
        const program = await compileNodeParticleGraph(graph);
        expect((await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program)).systems[0]!.targetStopDuration).toBe(7);
    });
});
