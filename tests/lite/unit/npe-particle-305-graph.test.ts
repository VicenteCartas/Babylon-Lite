import { describe, expect, it } from "vitest";
import { SCENE262_NPE_JSON } from "../../../lab/lite/src/shared/scene262-npe";
import { createScene305NpeGraph } from "../../../lab/lite/src/shared/scene305-teleport-npe";
import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import { buildNodeParticleSet } from "../../../packages/babylon-lite/src/particle/node/npe-build";
import { compileNodeParticleGraph } from "../../../packages/babylon-lite/src/particle/node/npe-compiler";
import { parseNodeParticleSource } from "../../../packages/babylon-lite/src/particle/node/npe-parser";
import type { ParsedParticleBlock } from "../../../packages/babylon-lite/src/particle/node/npe-types";
import { animateParticleSystem, startParticleSystem, type ParticleSystem } from "../../../packages/babylon-lite/src/particle/particle-system";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";

interface MutableInput {
    name?: string;
    targetBlockId?: number;
    targetConnectionName?: string;
}

interface MutableBlock {
    customType?: string;
    id: number;
    scope?: unknown;
    inputs: MutableInput[];
}

interface MutableGraph {
    blocks: MutableBlock[];
}

function withoutTexture(source: object): MutableGraph {
    const graph = structuredClone(source) as MutableGraph;
    const textureInput = graph.blocks.find((block) => block.customType === "BABYLON.SystemBlock")!.inputs.find((input) => input.name === "texture")!;
    delete textureInput.targetBlockId;
    delete textureInput.targetConnectionName;
    return graph;
}

function runDeterministic(system: ParticleSystem): Array<{ id: number } & Record<string, number>> {
    const previousRandom = Math.random;
    let seed = 1;
    Math.random = () => {
        const value = Math.sin(seed++) * 10000;
        return value - Math.floor(value);
    };
    try {
        startParticleSystem(system);
        for (let step = 0; step < 200; step++) {
            animateParticleSystem(system, 1);
        }
    } finally {
        Math.random = previousRandom;
    }

    const buffer = system.buffer;
    const particles: Array<{ id: number } & Record<string, number>> = [];
    for (let index = 0; index < buffer.alive; index++) {
        particles.push({
            id: buffer.id[index]!,
            posX: buffer.posX[index]!,
            posY: buffer.posY[index]!,
            posZ: buffer.posZ[index]!,
            dirX: buffer.dirX[index]!,
            dirY: buffer.dirY[index]!,
            dirZ: buffer.dirZ[index]!,
            age: buffer.age[index]!,
            lifeTime: buffer.lifeTime[index]!,
            size: buffer.size[index]!,
            angle: buffer.angle[index]!,
            scaleX: buffer.scaleX[index]!,
            scaleY: buffer.scaleY[index]!,
            colorR: buffer.colorR[index]!,
            colorG: buffer.colorG[index]!,
            colorB: buffer.colorB[index]!,
            colorA: buffer.colorA[index]!,
        });
    }
    return particles.sort((left, right) => left.id - right.id);
}

describe("Scene 305 compiled graph", () => {
    it("threads Elbow and Debug into a Particle LocalVariable without changing deterministic state", async () => {
        const source = withoutTexture(createScene305NpeGraph());
        const parsed = parseNodeParticleSource(source);
        const local = parsed.blocks.find((block) => block.customType === "BABYLON.ParticleLocalVariableBlock")!;
        expect(local.scope).toBe(0);

        const program = await compileNodeParticleGraph(parsed);
        const blockTypes = program._systems.flatMap((operations) =>
            operations.filter((operation): operation is ParsedParticleBlock => "customType" in operation).map((block) => block.customType)
        );
        expect(blockTypes).not.toContain("BABYLON.ParticleElbowBlock");
        expect(blockTypes).not.toContain("BABYLON.ParticleDebugBlock");

        const baseline = await buildNodeParticleSet(
            {} as EngineContext,
            {} as SceneContext,
            await compileNodeParticleGraph(parseNodeParticleSource(withoutTexture(SCENE262_NPE_JSON)))
        );
        const compiled = await buildNodeParticleSet({} as EngineContext, {} as SceneContext, program);
        expect(runDeterministic(compiled.systems[0]!)).toEqual(runDeterministic(baseline.systems[0]!));
        expect([...compiled.systems[0]!.buffer._columns.keys()].filter((name) => name.startsWith(`local.${local.id}.`))).toHaveLength(6);
    });
});
