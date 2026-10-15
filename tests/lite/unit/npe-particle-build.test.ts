import { afterEach, describe, expect, it, vi } from "vitest";
import { SCENE262_NPE_JSON } from "../../../lab/lite/src/shared/scene262-npe";
import changeEmitRateGraph from "./fixtures/change-emit-rate-npe.json";
import changeEmitRateTruth from "./fixtures/change-emit-rate-states.json";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import { parseNodeParticleSetFromSnippet } from "../../../packages/babylon-lite/src/particle/node/node-particle";
import { buildNodeParticleSet } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { buildNodeParticleSetWithFlowMaps } from "../../../packages/babylon-lite/src/particle/node/npe-flow-map";
import { buildNodeParticleSetWithNoiseTextures } from "../../../packages/babylon-lite/src/particle/node/npe-noise";
import { buildNodeParticleSetWithTextureUpdates } from "../../../packages/babylon-lite/src/particle/node/npe-texture-updates";
import { animateParticleSystem, startParticleSystem } from "../../../packages/babylon-lite/src/particle/particle-system";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";

interface MutableGraphSource {
    blocks: Array<{
        customType: string;
        inputs: Array<{ name: string; targetBlockId?: number; targetConnectionName?: string | null }>;
    }>;
}

function systemEmitRateInput(source: MutableGraphSource): MutableGraphSource["blocks"][number]["inputs"][number] {
    const system = source.blocks.find((block) => block.customType === "BABYLON.SystemBlock")!;
    return system.inputs.find((input) => input.name === "emitRate")!;
}

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("NPE build reachability", () => {
    it.each([
        ["flow maps", buildNodeParticleSetWithFlowMaps],
        ["noise textures", buildNodeParticleSetWithNoiseTextures],
        ["combined texture updates", buildNodeParticleSetWithTextureUpdates],
    ])("uses the compiled-program builder directly for %s", (_name, builder) => {
        expect(builder).toBe(buildNodeParticleSet);
    });

    it("builds typed-array systems through the canonical inline-JSON API", async () => {
        const set = await parseNodeParticleSetFromSnippet({} as EngineContext, {} as SceneContext, "", {
            json: SCENE262_NPE_JSON,
            emitter: { x: 0, y: 0, z: 0 },
        });

        expect(set.systems).toHaveLength(1);
        expect(set.systems[0]!.buffer.posX).toBeInstanceOf(Float32Array);
    });

    it("preserves a Color4 operand while reading another output from the same producer", async () => {
        const program = parseNodeParticleSource({
            blocks: [
                { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0080, value: [0, 0, 0, 0], inputs: [] },
                { customType: "BABYLON.ParticleInputBlock", id: 2, type: 0x0080, value: [1, 1, 1, 1], inputs: [] },
                {
                    customType: "BABYLON.ParticleRandomBlock",
                    id: 3,
                    lockMode: 0,
                    inputs: [
                        { name: "min", targetBlockId: 1, targetConnectionName: "output" },
                        { name: "max", targetBlockId: 2, targetConnectionName: "output" },
                    ],
                },
                {
                    customType: "BABYLON.ParticleConverterBlock",
                    id: 4,
                    inputs: [{ name: "color", targetBlockId: 3, targetConnectionName: "output" }],
                },
                {
                    customType: "BABYLON.ParticleMathBlock",
                    id: 5,
                    operation: 0,
                    inputs: [
                        { name: "left", targetBlockId: 4, targetConnectionName: "color" },
                        { name: "right", targetBlockId: 4, targetConnectionName: "x" },
                    ],
                },
                {
                    customType: "BABYLON.CreateParticleBlock",
                    id: 6,
                    inputs: [{ name: "color", targetBlockId: 5, targetConnectionName: "output" }],
                },
                {
                    customType: "BABYLON.SystemBlock",
                    id: 7,
                    capacity: 1,
                    updateSpeed: 1,
                    inputs: [
                        { name: "particle", targetBlockId: 6, targetConnectionName: "particle" },
                        { name: "emitRate", valueType: "number", value: 1 },
                    ],
                },
            ],
        });
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);
        const randomValues = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
        let randomIndex = 0;
        vi.spyOn(Math, "random").mockImplementation(() => randomValues[randomIndex++]!);

        startParticleSystem(set.systems[0]!);
        animateParticleSystem(set.systems[0]!, 1);

        expect(set.systems[0]!.buffer.colorR[0]).toBeCloseTo(0.6);
        expect(set.systems[0]!.buffer.colorG[0]).toBeCloseTo(0.7);
        expect(set.systems[0]!.buffer.colorB[0]).toBeCloseTo(0.8);
        expect(set.systems[0]!.buffer.colorA[0]).toBeCloseTo(0.9);
    });

    it("uses the Babylon NPE update-speed default when it is not serialized", async () => {
        const source = structuredClone(SCENE262_NPE_JSON) as { blocks: Array<Record<string, unknown>> };
        const system = source.blocks.find((block) => block.customType === "BABYLON.SystemBlock")!;
        delete system.updateSpeed;

        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, parseNodeParticleSource(source));

        expect(set.systems[0]!.updateSpeed).toBe(0.0167);
    });

    it.each([
        { name: "loads an embedded texture with explicit invertY false", url: "", invertY: false, expectedUrl: "embedded", expectedFlipY: true },
        { name: "applies Lite's class-default invertY when the field is omitted", url: "", invertY: undefined, expectedUrl: "embedded", expectedFlipY: false },
        {
            name: "deliberately prefers URL for serializer-unreachable dual-source input",
            url: "https://assets.example/particle.png",
            invertY: undefined,
            expectedUrl: "url",
            expectedFlipY: false,
        },
    ])("$name", async ({ url, invertY, expectedUrl, expectedFlipY }) => {
        const textureDataUrl = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
        const fetchMock = vi.fn(async () => ({ ok: true, blob: async () => ({}) }));
        vi.stubGlobal("fetch", fetchMock);
        vi.stubGlobal(
            "createImageBitmap",
            vi.fn(async () => ({ width: 1, height: 1, close: vi.fn() }))
        );
        const gpuTexture = { createView: vi.fn(() => ({})), destroy: vi.fn() };
        const copyExternalImageToTexture = vi.fn();
        const engine = {
            _device: {
                createTexture: vi.fn(() => gpuTexture),
                createSampler: vi.fn(() => ({})),
                queue: { copyExternalImageToTexture },
            },
        } as never;
        const program = parseNodeParticleSource({
            blocks: [
                {
                    customType: "BABYLON.SystemBlock",
                    id: 2,
                    inputs: [{ name: "texture", targetBlockId: 1, targetConnectionName: "texture" }],
                },
                {
                    customType: "BABYLON.ParticleTextureSourceBlock",
                    id: 1,
                    url,
                    serializedCachedData: true,
                    textureDataUrl,
                    ...(invertY === undefined ? {} : { invertY }),
                    inputs: [],
                },
            ],
        });

        const set = await buildNodeParticleSet(engine, {} as SceneContext, program);

        expect(fetchMock).toHaveBeenCalledWith(expectedUrl === "url" ? url : textureDataUrl);
        expect(copyExternalImageToTexture).toHaveBeenCalledWith(expect.objectContaining({ flipY: expectedFlipY }), expect.anything(), expect.anything());
        expect(set.systems[0]!.texture).toMatchObject({ width: 1, height: 1 });
    });

    it("ignores detached unsupported and OncePerParticle blocks", async () => {
        const source = JSON.parse(JSON.stringify(SCENE262_NPE_JSON)) as { blocks: Array<Record<string, unknown>> };
        source.blocks.push(
            { customType: "BABYLON.UnsupportedDetachedBlock", id: 10001, name: "detached unsupported", inputs: [], outputs: [] },
            { customType: "BABYLON.ParticleRandomBlock", id: 10002, name: "detached once", lockMode: 3, inputs: [], outputs: [{ name: "output" }] }
        );

        const program = parseNodeParticleSource(source);
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program, { emitter: { x: 0, y: 0, z: 0 } });
        expect(set.systems).toHaveLength(1);
        expect([...set.systems[0]!.buffer._columns.keys()].some((name) => name.startsWith("random.10002."))).toBe(false);
    });

    it("treats a port without a target connection name as unconnected", async () => {
        const source = structuredClone(changeEmitRateGraph) as MutableGraphSource;
        systemEmitRateInput(source).targetConnectionName = null;

        const program = parseNodeParticleSource(source);
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program, { emitter: { x: 0, y: 0, z: 0 } });
        const system = set.systems[0]!;

        expect(system.emitRate).toBe(10);
        expect(system._emitRateGetter).toBeUndefined();
    });

    it("does not evaluate a connected emit-rate graph during build", async () => {
        const source = structuredClone(changeEmitRateGraph) as MutableGraphSource;
        const emitRate = systemEmitRateInput(source);
        emitRate.targetBlockId = 8;
        emitRate.targetConnectionName = "output";

        const previousRandom = Math.random;
        let randomCalls = 0;
        Math.random = () => {
            randomCalls++;
            return 0.5;
        };
        try {
            const program = parseNodeParticleSource(source);
            const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program, { emitter: { x: 0, y: 0, z: 0 } });
            expect(set.systems[0]!._emitRateGetter).toBeDefined();
        } finally {
            Math.random = previousRandom;
        }

        expect(randomCalls).toBe(0);
    });

    it("re-evaluates a connected emit-rate graph from system time", async () => {
        const truth = changeEmitRateTruth as { N: number; count: number };
        const program = parseNodeParticleSource(changeEmitRateGraph);
        const set = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program, { emitter: { x: 0, y: 0, z: 0 } });
        const system = set.systems[0]!;
        expect(system._emitRateGetter).toBeDefined();

        const previousRandom = Math.random;
        let seed = 1;
        Math.random = () => {
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        };
        try {
            startParticleSystem(system);
            for (let step = 0; step < truth.N; step++) {
                animateParticleSystem(system, 1);
            }
        } finally {
            Math.random = previousRandom;
        }

        expect(system.buffer.alive).toBe(truth.count);
    });
});
