import { afterEach, describe, expect, it, vi } from "vitest";
import { createArcRotateCamera } from "../../../packages/babylon-lite/src/camera/arc-rotate";
import type { Camera } from "../../../packages/babylon-lite/src/camera/camera";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import { _resetMatrixAllocatorForTests, _setHpmAllocator } from "../../../packages/babylon-lite/src/math/_matrix-allocator";
import { mat4Identity } from "../../../packages/babylon-lite/src/math/mat4-identity";
import type { Mat4 } from "../../../packages/babylon-lite/src/math/types";
import { buildNodeParticleSet } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { compileNodeParticleGraph } from "../../../packages/babylon-lite/src/particle/node/npe-compiler";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import type { NodeParticleProgram } from "../../../packages/babylon-lite/src/particle/node/npe-types";
import { spawnParticle } from "../../../packages/babylon-lite/src/particle/particle-buffer";
import { animateParticleSystem, startParticleSystem, type ParticleSystem } from "../../../packages/babylon-lite/src/particle/particle-system";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";

interface GraphSource {
    blocks: Array<Record<string, unknown>>;
}

const OMIT_ALIGNMENT = Symbol("omit alignment");

function cameraGraph(systemSource = 4, alignment: unknown = 0.25, includeAlign = true): GraphSource {
    const createId = 2;
    const alignId = 3;
    const directionId = 4;
    return {
        blocks: [
            { customType: "BABYLON.ParticleInputBlock", id: 1, type: 0x0008, systemSource, inputs: [] },
            { customType: "BABYLON.CreateParticleBlock", id: createId, inputs: [] },
            ...(includeAlign
                ? [
                      {
                          customType: "BABYLON.AlignAngleBlock",
                          id: alignId,
                          ...(alignment === OMIT_ALIGNMENT ? {} : { alignment }),
                          inputs: [{ name: "particle", targetBlockId: createId, targetConnectionName: "particle" }],
                      },
                  ]
                : []),
            {
                customType: "BABYLON.UpdateDirectionBlock",
                id: directionId,
                inputs: [
                    { name: "particle", targetBlockId: includeAlign ? alignId : createId, targetConnectionName: "particle" },
                    { name: "direction", targetBlockId: 1, targetConnectionName: "output" },
                ],
            },
            { customType: "BABYLON.SystemBlock", id: 5, capacity: 1, inputs: [{ name: "particle", targetBlockId: directionId, targetConnectionName: "particle" }] },
        ],
    };
}

function cameraScene(camera: Camera | null): SceneContext {
    return { camera } as SceneContext;
}

async function compile(source: GraphSource): Promise<NodeParticleProgram> {
    return compileNodeParticleGraph(parseNodeParticleSource(source));
}

async function build(program: NodeParticleProgram, scene: SceneContext, emitterWorldMatrix?: Mat4): Promise<ParticleSystem> {
    return (await buildNodeParticleSet({} as EngineContext, scene, program, emitterWorldMatrix ? { emitterWorldMatrix } : {})).systems[0]!;
}

function prime(system: ParticleSystem, direction: readonly [number, number, number], angle = 0): void {
    const index = spawnParticle(system.buffer);
    system.buffer.lifeTime[index] = 100;
    system.buffer.dirX[index] = direction[0];
    system.buffer.dirY[index] = direction[1];
    system.buffer.dirZ[index] = direction[2];
    system.buffer.angle[index] = angle;
    system.emitRate = 0;
    startParticleSystem(system);
}

afterEach(() => {
    vi.restoreAllMocks();
    _resetMatrixAllocatorForTests();
});

describe("NPE camera-dependent blocks", () => {
    it("refreshes CameraPosition and AlignAngle from a moving camera", async () => {
        const program = await compile(cameraGraph());
        const camera = createArcRotateCamera(0, Math.PI / 2, 10, { x: 0, y: 0, z: 0 });
        const system = await build(program, cameraScene(camera));
        prime(system, [1, 1, 0]);

        animateParticleSystem(system, 1);

        expect(system.buffer.dirX[0]).toBeCloseTo(10, 5);
        expect(system.buffer.dirY[0]).toBeCloseTo(0, 5);
        expect(system.buffer.dirZ[0]).toBeCloseTo(0, 5);
        expect(system.buffer.angle[0]).toBeCloseTo(Math.PI / 2 + 0.25, 5);

        camera.alpha = Math.PI / 2;
        system.buffer.dirX[0] = 1;
        system.buffer.dirY[0] = 1;
        system.buffer.dirZ[0] = 0;
        animateParticleSystem(system, 1);

        expect(system.buffer.dirX[0]).toBeCloseTo(0, 5);
        expect(system.buffer.dirY[0]).toBeCloseTo(0, 5);
        expect(system.buffer.dirZ[0]).toBeCloseTo(10, 5);
        expect(system.buffer.angle[0]).toBeCloseTo((3 * Math.PI) / 4 + 0.25, 5);
    });

    it("uses zero CameraPosition and preserves angle without an active camera", async () => {
        const program = await compile(cameraGraph());
        const system = await build(program, cameraScene(null));
        prime(system, [1, 1, 0], -0.75);

        animateParticleSystem(system, 1);

        expect(system.buffer.dirX[0]).toBe(0);
        expect(system.buffer.dirY[0]).toBe(0);
        expect(system.buffer.dirZ[0]).toBe(0);
        expect(system.buffer.angle[0]).toBe(-0.75);
    });

    it("defaults alignment to pi over two", async () => {
        const program = await compile(cameraGraph(4, OMIT_ALIGNMENT));
        const camera = createArcRotateCamera(0, Math.PI / 2, 10, { x: 0, y: 0, z: 0 });
        const system = await build(program, cameraScene(camera));
        prime(system, [0, 0, 1]);

        animateParticleSystem(system, 1);

        expect(system.buffer.angle[0]).toBeCloseTo(Math.PI / 2, 5);
    });

    it("allocates no matrix for CameraPosition alone and one shared view matrix per aligned system", async () => {
        const firstCamera = createArcRotateCamera(0, Math.PI / 2, 10, { x: 0, y: 0, z: 0 });
        const secondCamera = createArcRotateCamera(Math.PI / 2, Math.PI / 2, 10, { x: 0, y: 0, z: 0 });
        const emitterWorldMatrix = mat4Identity();
        const positionProgram = await compile(cameraGraph(4, 0.25, false));
        const alignedProgram = await compile(cameraGraph());
        const allocations: Float64Array[] = [];
        _setHpmAllocator(() => {
            const matrix = new Float64Array(16);
            allocations.push(matrix);
            return matrix as unknown as Mat4;
        });

        await build(positionProgram, cameraScene(firstCamera), emitterWorldMatrix);
        expect(allocations).toHaveLength(0);

        const first = await build(alignedProgram, cameraScene(firstCamera), emitterWorldMatrix);
        const second = await build(alignedProgram, cameraScene(secondCamera), emitterWorldMatrix);

        expect(allocations).toHaveLength(2);
        expect(allocations[0]).not.toBe(allocations[1]);
        expect(first._prepareFrame).not.toBe(second._prepareFrame);
    });

    it("runs prior frame preparation before taking the shared camera snapshot", async () => {
        const program = await compile(cameraGraph(4, 0.25, false));
        const camera = createArcRotateCamera(0, Math.PI / 2, 10, { x: 0, y: 0, z: 0 });
        const previous = vi.fn(() => {
            camera.alpha = Math.PI / 2;
        });
        const set = await buildNodeParticleSet({} as EngineContext, cameraScene(camera), program, {
            _setupEmitter(state) {
                state.system!._prepareFrame = previous;
            },
        });
        const system = set.systems[0]!;
        prime(system, [1, 0, 0]);

        animateParticleSystem(system, 1);

        expect(previous).toHaveBeenCalledTimes(1);
        expect(system.buffer.dirX[0]).toBeCloseTo(0, 5);
        expect(system.buffer.dirZ[0]).toBeCloseTo(10, 5);
    });

    it("preserves the unsupported system-source diagnostic", async () => {
        const program = await compile(cameraGraph(5, 0.25, false));

        await expect(build(program, cameraScene(null))).rejects.toThrow("NodeParticle: unsupported system source 5");
    });
});
