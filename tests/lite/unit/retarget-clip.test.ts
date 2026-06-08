import { describe, expect, it } from "vitest";

import { retargetClip } from "../../../packages/babylon-lite/src/loader-gltf/load-gltf-animated";
import type { AnimationClip } from "../../../packages/babylon-lite/src/animation/types";
import { PATH_ROTATION, PATH_TRANSLATION } from "../../../packages/babylon-lite/src/animation/types";

/** Minimal clip whose channels target source node indices 0..2. */
function makeClip(): AnimationClip {
    return {
        name: "Walk",
        duration: 1,
        samplers: [
            { input: new Float32Array([0, 1]), output: new Float32Array([0, 0, 0, 1, 1, 1]), interpolation: 0 },
            { input: new Float32Array([0, 1]), output: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1]), interpolation: 0 },
        ],
        channels: [
            { samplerIdx: 0, nodeIdx: 0, path: PATH_TRANSLATION }, // source node 0 = "hips"
            { samplerIdx: 1, nodeIdx: 1, path: PATH_ROTATION }, // source node 1 = "spine"
            { samplerIdx: 0, nodeIdx: 2, path: PATH_TRANSLATION }, // source node 2 = "tail" (no target match)
        ],
    };
}

describe("retargetClip", () => {
    it("remaps channels from source node indices to target indices by name", () => {
        const sourceNames = ["hips", "spine", "tail"];
        // Target rig lists the same joints in a DIFFERENT order.
        const nameToIndex = new Map<string, number>([
            ["spine", 5],
            ["hips", 9],
        ]);

        const out = retargetClip(makeClip(), sourceNames, nameToIndex);
        expect(out).not.toBeNull();
        // "tail" has no target match → dropped; "hips"→9, "spine"→5.
        expect(out!.channels).toEqual([
            { samplerIdx: 0, nodeIdx: 9, path: PATH_TRANSLATION },
            { samplerIdx: 1, nodeIdx: 5, path: PATH_ROTATION },
        ]);
        expect(out!.duration).toBe(1);
        expect(out!.name).toBe("Walk");
    });

    it("returns null when no channel maps onto the target rig", () => {
        const sourceNames = ["a", "b"];
        const clip: AnimationClip = {
            name: "x",
            duration: 0,
            samplers: [{ input: new Float32Array([0]), output: new Float32Array([0, 0, 0]), interpolation: 0 }],
            channels: [{ samplerIdx: 0, nodeIdx: 0, path: PATH_TRANSLATION }],
        };
        expect(retargetClip(clip, sourceNames, new Map([["z", 0]]))).toBeNull();
    });
});
