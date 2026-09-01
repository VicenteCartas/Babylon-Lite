import { describe, expect, it } from "vitest";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { NpeBuildContext } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { buildNodeParticleSet, compileNodeParticleGraph } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import { loadValueBlockEvaluator } from "../../../packages/babylon-lite/src/particle/node/npe-registry-extra-values";
import { loadNodeParticleValueMathEvaluator } from "../../../packages/babylon-lite/src/particle/node/npe-registry-value-math";
import type { ParsedParticleBlock, ParsedParticleInput } from "../../../packages/babylon-lite/src/particle/node/npe-types";
import type { NpeGetter, NpeValue } from "../../../packages/babylon-lite/src/particle/node/npe-value";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";

interface GetterOptions {
    readonly inputs: Record<string, NpeGetter>;
}

async function buildGetter(className: string, fields: Record<string, unknown>, options: GetterOptions): Promise<NpeGetter> {
    const inputs: ParsedParticleInput[] = Object.keys(options.inputs).map((name, index) => ({
        name,
        targetBlockId: index + 100,
        targetConnectionName: "output",
    }));
    const block: ParsedParticleBlock = { id: 7, customType: `BABYLON.${className}`, inputs, ...fields };
    let output: NpeGetter | undefined;
    const context = {
        input(_block: ParsedParticleBlock, name: string, fallback?: NpeGetter): NpeGetter {
            return options.inputs[name] ?? fallback ?? (() => null as unknown as NpeValue);
        },
        isConnected(_block: ParsedParticleBlock, name: string): boolean {
            return name in options.inputs;
        },
        setOutput(_blockId: number, name: string, getter: NpeGetter): void {
            if (name === "output") {
                output = getter;
            }
        },
    } as unknown as NpeBuildContext;
    const evaluator = (await loadNodeParticleValueMathEvaluator(block)) ?? (await loadValueBlockEvaluator(className));
    evaluator.build(block, context);
    return output!;
}

describe("NPE Phase 4B value math", () => {
    describe("ParticleTrigonometryBlock", () => {
        const operations: ReadonlyArray<readonly [number, (value: number) => number]> = [
            [0, Math.cos],
            [1, Math.sin],
            [2, Math.abs],
            [3, Math.exp],
            [4, (value) => Math.pow(2, value)],
            [5, Math.round],
            [6, Math.floor],
            [7, Math.ceil],
            [8, Math.sqrt],
            [9, Math.log],
            [10, Math.tan],
            [11, Math.atan],
            [12, Math.acos],
            [13, Math.asin],
            [14, Math.sign],
            [15, (value) => -value],
            [16, (value) => 1 - value],
            [17, (value) => 1 / value],
            [18, (value) => (value * 180) / Math.PI],
            [19, (value) => (value * Math.PI) / 180],
            [20, (value) => (value >= 0 ? value - Math.floor(value) : value - Math.ceil(value))],
        ];

        it.each(operations)("evaluates operation %s", async (operation, evaluate) => {
            const output = await buildGetter("ParticleTrigonometryBlock", { operation }, { inputs: { input: () => 0.25 } });
            expect(output(0)).toBe(evaluate(0.25));
        });

        it("defaults to Cos and preserves negative Fract", async () => {
            const cosine = await buildGetter("ParticleTrigonometryBlock", {}, { inputs: { input: () => 0 } });
            const fract = await buildGetter("ParticleTrigonometryBlock", { operation: 20 }, { inputs: { input: () => -1.25 } });
            expect(cosine(0)).toBe(1);
            expect(fract(0)).toBe(-0.25);
        });

        it("maps vector and color components into reused output scratch", async () => {
            const vector = await buildGetter("ParticleTrigonometryBlock", { operation: 2 }, { inputs: { input: () => ({ x: -1, y: -2, z: -3 }) } });
            const color = await buildGetter("ParticleTrigonometryBlock", { operation: 15 }, { inputs: { input: () => ({ r: 1, g: 2, b: 3, a: 4 }) } });
            const first = vector(0);
            expect(first).toEqual({ x: 1, y: 2, z: 3 });
            expect(vector(1)).toBe(first);
            expect(color(0)).toEqual({ r: -1, g: -2, b: -3, a: -4 });
        });

        it("rejects missing input and unknown operations", async () => {
            await expect(buildGetter("ParticleTrigonometryBlock", {}, { inputs: {} })).rejects.toThrow('NodeParticle: ParticleTrigonometryBlock 7 input "input" is not connected');
            await expect(buildGetter("ParticleTrigonometryBlock", { operation: 21 }, { inputs: { input: () => 1 } })).rejects.toThrow(
                "NodeParticle: ParticleTrigonometryBlock 7 has unsupported operation 21"
            );
        });
    });

    describe("ParticleVectorMathBlock", () => {
        it("evaluates Dot and Distance", async () => {
            const dot = await buildGetter("ParticleVectorMathBlock", { operation: 0 }, { inputs: { left: () => ({ x: 1, y: 2, z: 3 }), right: () => ({ x: 4, y: 5, z: 6 }) } });
            const distance = await buildGetter(
                "ParticleVectorMathBlock",
                { operation: 1 },
                { inputs: { left: () => ({ x: 1, y: 2, z: 3 }), right: () => ({ x: 4, y: 6, z: 3 }) } }
            );
            expect(dot(0)).toBe(32);
            expect(distance(0)).toBe(5);
        });

        it("copies an aliased left value before reading right", async () => {
            const scratch = { x: 0, y: 0, z: 0 };
            let call = 0;
            const aliased = () => {
                const values = call++ % 2 === 0 ? [1, 2, 3] : [4, 5, 6];
                scratch.x = values[0]!;
                scratch.y = values[1]!;
                scratch.z = values[2]!;
                return scratch;
            };
            const output = await buildGetter("ParticleVectorMathBlock", {}, { inputs: { left: aliased, right: aliased } });
            expect(output(0)).toBe(32);
        });
    });

    describe("ParticleSmoothStepBlock", () => {
        it("uses default edges and maps vector components", async () => {
            const scalar = await buildGetter("ParticleSmoothStepBlock", {}, { inputs: { value: () => 0.5 } });
            const vector = await buildGetter("ParticleSmoothStepBlock", {}, { inputs: { value: () => ({ x: -1, y: 0.5, z: 2 }), edge0: () => 0, edge1: () => 1 } });
            expect(scalar(0)).toBe(0.5);
            expect(vector(0)).toEqual({ x: 0, y: 0.5, z: 1 });
        });

        it("preserves equal-edge NaN behavior", async () => {
            const output = await buildGetter("ParticleSmoothStepBlock", {}, { inputs: { value: () => 1, edge0: () => 1, edge1: () => 1 } });
            expect(output(0)).toBeNaN();
        });
    });

    describe("ParticleNLerpBlock", () => {
        it("lerps scalars without normalization and normalizes vectors and colors", async () => {
            const normalizedHalf = 0.5 * (1 / Math.sqrt(0.5));
            const scalar = await buildGetter("ParticleNLerpBlock", {}, { inputs: { left: () => 2, right: () => 4, gradient: () => 1.5 } });
            const vector = await buildGetter("ParticleNLerpBlock", {}, { inputs: { left: () => ({ x: 1, y: 0 }), right: () => ({ x: 0, y: 1 }), gradient: () => 0.5 } });
            const color = await buildGetter(
                "ParticleNLerpBlock",
                {},
                { inputs: { left: () => ({ r: 1, g: 0, b: 0, a: 0 }), right: () => ({ r: 0, g: 0, b: 0, a: 1 }), gradient: () => 0.5 } }
            );
            expect(scalar(0)).toBe(5);
            expect(vector(0)).toEqual({ x: normalizedHalf, y: normalizedHalf });
            expect(color(0)).toEqual({ r: normalizedHalf, g: 0, b: 0, a: normalizedHalf });
        });

        it("copies aliased inputs and reuses its output scratch", async () => {
            const normalizedHalf = 0.5 * (1 / Math.sqrt(0.5));
            const scratch = { x: 0, y: 0 };
            let call = 0;
            const aliased = () => {
                scratch.x = call++ % 2 === 0 ? 1 : 0;
                scratch.y = scratch.x === 1 ? 0 : 1;
                return scratch;
            };
            const output = await buildGetter("ParticleNLerpBlock", {}, { inputs: { left: aliased, right: aliased, gradient: () => 0.5 } });
            const first = output(0);
            expect(first).toEqual({ x: normalizedHalf, y: normalizedHalf });
            expect(output(1)).toBe(first);
        });
    });

    it("compiles one reachable graph containing all four Phase 4B classes", async () => {
        const source = parseNodeParticleSource({
            blocks: [
                { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0002, value: 0.25, inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 2, type: 0x0002, value: 0.75, inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 3, type: 0x0008, value: [1, 0, 0], inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 4, type: 0x0008, value: [0, 1, 0], inputs: [] },
                {
                    customType: "BABYLON.ParticleVectorMathBlock",
                    id: 5,
                    inputs: [
                        { name: "left", targetBlockId: 3, targetConnectionName: "output" },
                        { name: "right", targetBlockId: 4, targetConnectionName: "output" },
                    ],
                },
                {
                    customType: "BABYLON.ParticleNLerpBlock",
                    id: 6,
                    inputs: [
                        { name: "left", targetBlockId: 1, targetConnectionName: "output" },
                        { name: "right", targetBlockId: 2, targetConnectionName: "output" },
                        { name: "gradient", targetBlockId: 5, targetConnectionName: "output" },
                    ],
                },
                { customType: "BABYLON.ParticleSmoothStepBlock", id: 7, inputs: [{ name: "value", targetBlockId: 6, targetConnectionName: "output" }] },
                { customType: "BABYLON.ParticleTrigonometryBlock", id: 8, operation: 2, inputs: [{ name: "input", targetBlockId: 7, targetConnectionName: "output" }] },
                { customType: "BABYLON.SystemBlock", id: 9, inputs: [{ name: "emitRate", targetBlockId: 8, targetConnectionName: "output" }] },
            ],
        });
        const program = await compileNodeParticleGraph(source);
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);
        expect(set.systems[0]!._emitRateGetter!()).toBe(0.15625);
    });

    it("propagates an Int source through Phase 4B without class-name detection", async () => {
        const source = parseNodeParticleSource({
            blocks: [
                { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0001, value: 1, inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 2, type: 0x0002, value: 2, inputs: [] },
                { customType: "BABYLON.ParticleTrigonometryBlock", id: 3, operation: 1, inputs: [{ name: "input", targetBlockId: 1, targetConnectionName: "output" }] },
                {
                    customType: "BABYLON.ParticleNumberMathBlock",
                    id: 4,
                    operation: 0,
                    inputs: [
                        { name: "left", targetBlockId: 3, targetConnectionName: "output" },
                        { name: "right", targetBlockId: 2, targetConnectionName: "output" },
                    ],
                },
                { customType: "BABYLON.SystemBlock", id: 5, inputs: [{ name: "emitRate", targetBlockId: 4, targetConnectionName: "output" }] },
            ],
        });
        const program = await compileNodeParticleGraph(source);
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);
        expect(set.systems[0]!._emitRateGetter!()).toBe(0);
    });
});
