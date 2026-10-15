import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { createFeatureGraph } from "../../../lab/lite/src/shared/scene332-features-npe";

const root = resolve(__dirname, "../../..");
const config = JSON.parse(readFileSync(resolve(root, "scene-config.json"), "utf8")) as Array<{ id: number; slug: string; maxMad: number; maxRawKB: number }>;

describe("NPE feature scene configuration", () => {
    it.each([332, 333, 334, 335, 336, 337])("registers scene %i with immutable golden-only parity and presentation assets", (id) => {
        const matches = config.filter((scene) => scene.id === id);
        expect(matches).toHaveLength(1);
        const scene = matches[0]!;
        expect(scene.maxMad).toBeGreaterThan(0);
        expect(scene.maxRawKB).toBeGreaterThan(0);
        for (const file of [
            `lab/lite/scene${id}.html`,
            `lab/lite/bundle-scene${id}.html`,
            `lab/lite/babylon-ref-scene${id}.html`,
            `lab/lite/src/lite/scene${id}.ts`,
            `lab/lite/src/bjs/scene${id}.ts`,
            `lab/public/thumbnails/scene${id}.jpg`,
            `reference/lite/${scene.slug}/babylon-ref-golden.png`,
        ]) {
            expect(existsSync(resolve(root, file)), file).toBe(true);
        }
        const spec = readFileSync(resolve(root, `tests/lite/parity/scenes/${scene.slug}.spec.ts`), "utf8");
        expect(spec).not.toContain("captureGolden");
        expect(spec).not.toContain("babylon-ref-scene");
        expect(spec).toContain(`scene${id}.html?seekTime=1`);
        expect(spec).toContain("data-animation-frozen");
    });

    it("serializes all four core updates, camera inputs, prewarm, render properties, and geometry modes", () => {
        const blocks = (id: number) => (createFeatureGraph(id, "flare.png") as { blocks: Array<Record<string, unknown>> }).blocks;
        expect(blocks(332).map((block) => block.customType)).toEqual(
            expect.arrayContaining(["BABYLON.UpdateScaleBlock", "BABYLON.UpdateAgeBlock", "BABYLON.BasicPositionUpdateBlock", "BABYLON.BasicColorUpdateBlock"])
        );
        expect(blocks(333).find((block) => block.customType === "BABYLON.SystemBlock")).toMatchObject({ preWarmCycles: 90, preWarmStepOffset: 2, manualEmitCount: -1 });
        expect(blocks(334).find((block) => block.systemSource === 4)).toMatchObject({ customType: "BABYLON.ParticleInputBlock", contextualValue: 0 });
        expect(blocks(334).find((block) => block.customType === "BABYLON.AlignAngleBlock")).toMatchObject({ alignment: 0.4 });
        expect(
            blocks(335)
                .filter((block) => block.customType === "BABYLON.SystemBlock")
                .map((block) => block.renderingGroupId)
        ).toEqual([2, 0, 1]);
        expect(
            blocks(336)
                .filter((block) => block.customType === "BABYLON.SystemBlock")
                .map((block) => [block.billBoardMode, block.isBillboardBased])
        ).toEqual([
            [2, true],
            [8, true],
            [9, true],
            [7, false],
        ]);
    });
});
