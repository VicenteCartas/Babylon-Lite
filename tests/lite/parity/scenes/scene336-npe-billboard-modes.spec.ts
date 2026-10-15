import { test, expect } from "../parity-fixtures";
import * as path from "path";
import { attachCompareArtifacts, compareImages, getSceneConfig, waitForCanvasReady } from "../compare-utils";

const sceneConfig = getSceneConfig(336);
const REFERENCE_DIR = path.resolve(__dirname, "../../../../reference/lite/scene336-npe-billboard-modes");
const GOLDEN_REF = path.join(REFERENCE_DIR, "babylon-ref-golden.png");

test("Scene 336 — NPE billboard modes match the committed Babylon golden", async ({ page }, testInfo) => {
    await page.goto("/scene336.html?seekTime=1");
    await waitForCanvasReady(page, { timeout: 20_000, label: "Scene 336 Lite" });
    await expect(page.locator("canvas")).toHaveAttribute("data-animation-frozen", "true");
    await page.waitForTimeout(500);
    const actual = path.join(REFERENCE_DIR, "test-actual.png");
    await page.locator("canvas").screenshot({ path: actual });
    const full = compareImages(actual, GOLDEN_REF);
    await attachCompareArtifacts(testInfo, actual, GOLDEN_REF, REFERENCE_DIR);
    console.log(`Scene 336 MAD=${full.mad.toFixed(6)} maxMad=${sceneConfig.maxMad}`);
    expect(full.mad).toBeLessThanOrEqual(sceneConfig.maxMad);
});
