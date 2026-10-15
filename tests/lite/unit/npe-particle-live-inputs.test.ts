import { describe, expect, it } from "vitest";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";
import { buildNodeParticleSet } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import type { NpeBuildContext } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { particleInputBlock } from "../../../packages/babylon-lite/src/particle/node/blocks/particle-input-block";
import type { NpeGetter } from "../../../packages/babylon-lite/src/particle/node/npe-value";
import { compileNodeParticleGraph } from "../../../packages/babylon-lite/src/particle/node/npe-compiler";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import { animateParticleSystem, startParticleSystem } from "../../../packages/babylon-lite/src/particle/particle-system";

const engine = {} as EngineContext;
const scene = {} as SceneContext;

async function build(source: object) {
    return buildNodeParticleSet(engine, scene, await compileNodeParticleGraph(parseNodeParticleSource(source)));
}

describe("NPE live input handles", () => {
    it.each(["absent", "missing"] as const)("keeps constant fallbacks when the live-input hook is %s", (mode) => {
        for (const constant of [
            { type: 0x0002, value: 0, expected: 0 },
            { type: 0x0008, value: [1, 2, 3], expected: { x: 1, y: 2, z: 3 } },
        ]) {
            const getters: NpeGetter[] = [];
            const context = {
                ...(mode === "missing" ? { _inputValue: () => undefined } : {}),
                setOutput(_blockId: number, name: string, getter: NpeGetter) {
                    expect(name).toBe("output");
                    getters.push(getter);
                },
            } as unknown as NpeBuildContext;
            const block = { id: 1, customType: "BABYLON.ParticleInputBlock", inputs: [], type: constant.type, value: constant.value };
            particleInputBlock.build(block, context);
            particleInputBlock.build(block, context);
            const first = getters[0]!(0);
            const second = getters[1]!(0);
            expect(first).toEqual(constant.expected);
            expect(second).toEqual(constant.expected);
            expect(getters[0]!(1)).toBe(first);
            if (typeof first !== "number") {
                expect(second).not.toBe(first);
                Object.assign(first, { x: 99 });
                expect(second).toEqual(constant.expected);
            }
        }
    });

    it("publishes the live cell itself when one exists", () => {
        let value = 0;
        const cell: NpeGetter = () => value;
        let output: NpeGetter | undefined;
        const context = {
            _inputValue(blockId: number) {
                expect(blockId).toBe(1);
                return cell;
            },
            setOutput(_blockId: number, _name: string, getter: NpeGetter) {
                output = getter;
            },
        } as unknown as NpeBuildContext;
        particleInputBlock.build({ id: 1, customType: "BABYLON.ParticleInputBlock", inputs: [], value: 12 }, context);
        expect(output).toBe(cell);
        expect(output!(0)).toBe(0);
        value = 7;
        expect(output!(0)).toBe(7);
    });

    it("exposes reachable named constants with authored inspector metadata", async () => {
        const set = await build({
            blocks: [
                {
                    customType: "BABYLON.ParticleInputBlock",
                    id: 1,
                    name: "Count",
                    type: 0x0001,
                    value: 3,
                    min: -5,
                    max: 5,
                    groupInInspector: "Emission",
                    displayInInspector: true,
                    inputs: [],
                },
                {
                    customType: "BABYLON.ParticleInputBlock",
                    id: 2,
                    name: "Scale",
                    type: 0x0004,
                    value: [1, 2],
                    groupInInspector: "Shape",
                    displayInInspector: false,
                    inputs: [],
                },
                { customType: "BABYLON.ParticleInputBlock", id: 3, name: "Tint", type: 0x0080, value: [0.1, 0.2, 0.3, 0.4], inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 4, name: "Direction", type: 0x0008, value: [1, 2, 3], inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 5, name: "Age", contextualValue: 3, inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 6, name: "Time", systemSource: 1, inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 7, type: 0x0080, value: [0, 0, 0, 0], inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 8, name: "Detached", type: 0x0002, value: 8, inputs: [] },
                {
                    customType: "BABYLON.CreateParticleBlock",
                    id: 10,
                    inputs: [
                        { name: "size", targetBlockId: 1, targetConnectionName: "output" },
                        { name: "scale", targetBlockId: 2, targetConnectionName: "output" },
                        { name: "color", targetBlockId: 3, targetConnectionName: "output" },
                        { name: "angle", targetBlockId: 5, targetConnectionName: "output" },
                        { name: "lifeTime", targetBlockId: 6, targetConnectionName: "output" },
                        { name: "colorDead", targetBlockId: 7, targetConnectionName: "output" },
                    ],
                },
                {
                    customType: "BABYLON.PointShapeBlock",
                    id: 11,
                    inputs: [
                        { name: "particle", targetBlockId: 10, targetConnectionName: "particle" },
                        { name: "direction1", targetBlockId: 4, targetConnectionName: "output" },
                    ],
                },
                { customType: "BABYLON.SystemBlock", id: 12, inputs: [{ name: "particle", targetBlockId: 11, targetConnectionName: "particle" }] },
            ],
        });

        expect(Object.keys(set.inputs)).toEqual(["Count", "Scale", "Tint", "Direction"]);
        expect(set.inputs.Count).toMatchObject({
            type: "i32",
            value: 3,
            min: -5,
            max: 5,
            groupInInspector: "Emission",
            displayInInspector: true,
        });
        expect(set.inputs.Scale).toMatchObject({
            type: "vec2f",
            value: [1, 2],
            min: 0,
            max: 0,
            groupInInspector: "Shape",
            displayInInspector: false,
        });
        expect(set.inputs.Tint).toMatchObject({ type: "vec4f", value: [0.1, 0.2, 0.3, 0.4] });
        expect(set.inputs.Direction).toMatchObject({ type: "vec3f", value: [1, 2, 3] });

        const scaleRead = set.inputs.Scale!.value as number[];
        scaleRead[0] = 99;
        expect(set.inputs.Scale!.value).toEqual([1, 2]);
        set.inputs.Scale!.value = [4, 5];
        expect(set.inputs.Scale!.value).toEqual([4, 5]);
        set.inputs.Count!.value = 12;
        expect(set.inputs.Count!.value).toBe(12);
    });

    it("uses the later serialized duplicate name without merging value cells", async () => {
        const set = await build({
            blocks: [
                { customType: "BABYLON.ParticleInputBlock", id: 1, name: "Duplicate", type: 0x0002, value: 1, groupInInspector: "First", inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 2, name: "Duplicate", type: 0x0002, value: 2, groupInInspector: "Second", inputs: [] },
                {
                    customType: "BABYLON.CreateParticleBlock",
                    id: 3,
                    inputs: [
                        { name: "size", targetBlockId: 1, targetConnectionName: "output" },
                        { name: "lifeTime", targetBlockId: 2, targetConnectionName: "output" },
                    ],
                },
                { customType: "BABYLON.SystemBlock", id: 4, inputs: [{ name: "particle", targetBlockId: 3, targetConnectionName: "particle" }] },
            ],
        });
        const system = set.systems[0]!;

        expect(Object.keys(set.inputs)).toEqual(["Duplicate"]);
        expect(set.inputs.Duplicate).toBe(set.inputs.Duplicate);
        expect(set.inputs.Duplicate).toMatchObject({ value: 2, groupInInspector: "Second" });
        set.inputs.Duplicate!.value = 7;
        system.createSize!(0);
        system.createLifeTime!(0);

        expect(system.buffer.size[0]).toBe(1);
        expect(system.buffer.lifeTime[0]).toBe(7);
    });

    it("shares one block cell across systems but isolates repeated program builds", async () => {
        const program = await compileNodeParticleGraph(
            parseNodeParticleSource({
                blocks: [
                    { customType: "BABYLON.ParticleInputBlock", id: 1, name: "Shared", type: 0x0002, value: 1, inputs: [] },
                    { customType: "BABYLON.CreateParticleBlock", id: 2, inputs: [{ name: "size", targetBlockId: 1, targetConnectionName: "output" }] },
                    { customType: "BABYLON.CreateParticleBlock", id: 3, inputs: [{ name: "size", targetBlockId: 1, targetConnectionName: "output" }] },
                    { customType: "BABYLON.SystemBlock", id: 4, inputs: [{ name: "particle", targetBlockId: 2, targetConnectionName: "particle" }] },
                    { customType: "BABYLON.SystemBlock", id: 5, inputs: [{ name: "particle", targetBlockId: 3, targetConnectionName: "particle" }] },
                ],
            })
        );
        const first = await buildNodeParticleSet(engine, scene, program);
        const second = await buildNodeParticleSet(engine, scene, program);

        expect(first.inputs.Shared).not.toBe(second.inputs.Shared);
        first.inputs.Shared!.value = 6;
        first.systems[0]!.createSize!(0);
        first.systems[1]!.createSize!(0);
        second.systems[0]!.createSize!(0);

        expect(first.systems[0]!.buffer.size[0]).toBe(6);
        expect(first.systems[1]!.buffer.size[0]).toBe(6);
        expect(second.systems[0]!.buffer.size[0]).toBe(1);
        expect(second.inputs.Shared!.value).toBe(1);
    });

    it("clamps Float writes and applies a mutation on the next simulation step", async () => {
        const set = await build({
            blocks: [
                {
                    customType: "BABYLON.ParticleInputBlock",
                    id: 1,
                    name: "Live size",
                    type: 0x0002,
                    value: 1,
                    min: 0,
                    max: 3,
                    inputs: [],
                },
                {
                    customType: "BABYLON.CreateParticleBlock",
                    id: 2,
                    inputs: [
                        { name: "lifeTime", valueType: "number", value: 10 },
                        { name: "size", targetBlockId: 1, targetConnectionName: "output" },
                    ],
                },
                {
                    customType: "BABYLON.UpdateSizeBlock",
                    id: 3,
                    inputs: [
                        { name: "particle", targetBlockId: 2, targetConnectionName: "particle" },
                        { name: "size", targetBlockId: 1, targetConnectionName: "output" },
                    ],
                },
                {
                    customType: "BABYLON.SystemBlock",
                    id: 4,
                    capacity: 1,
                    updateSpeed: 1,
                    inputs: [
                        { name: "particle", targetBlockId: 3, targetConnectionName: "particle" },
                        { name: "emitRate", valueType: "number", value: 1 },
                    ],
                },
            ],
        });
        const system = set.systems[0]!;

        startParticleSystem(system);
        animateParticleSystem(system, 1);
        expect(system.buffer.size[0]).toBe(1);

        set.inputs["Live size"]!.value = 10;
        expect(set.inputs["Live size"]!.value).toBe(3);
        animateParticleSystem(system, 1);
        expect(system.buffer.size[0]).toBe(3);

        set.inputs["Live size"]!.value = -10;
        expect(set.inputs["Live size"]!.value).toBe(0);
    });
});
