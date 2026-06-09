import { describe, expect, it, vi } from "vitest";

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { AnimationGroup } from "../../../packages/babylon-lite/src/animation/animation-group";
import { addAnimationGroups } from "../../../packages/babylon-lite/src/animation/animation-group-task";
import { createAnimationManager, updateAnimationManager } from "../../../packages/babylon-lite/src/animation/animation-manager";
import { enableAnimationBlending, getBlendedJointWorldMatrix } from "../../../packages/babylon-lite/src/animation/weighted-gltf-mixer";
import type { AnimationClip, NodeRest, SkeletonBinding } from "../../../packages/babylon-lite/src/animation/types";
import { INTERP_LINEAR, PATH_SCALE, PATH_TRANSLATION } from "../../../packages/babylon-lite/src/animation/types";
import type { Mat4 } from "../../../packages/babylon-lite/src/math/types";

// prettier-ignore
const IDENTITY = new Float32Array([1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]);

/** A two-node rig (root + one joint) used to probe the joint's blended scale. */
function makeRig(): { nodes: NodeRest[]; skeletons: SkeletonBinding[] } {
    const root: NodeRest = { parentIdx: -1, tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1 };
    const joint: NodeRest = { parentIdx: 0, tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1 };
    const skeletons: SkeletonBinding[] = [
        {
            jointNodes: [1],
            inverseBindMatrices: new Float32Array(IDENTITY),
            invMeshWorld: new Float32Array(IDENTITY) as unknown as Mat4,
            boneTexture: {} as unknown as GPUTexture,
            boneCount: 1,
            boneMatrices: new Float32Array(16),
        },
    ];
    return { nodes: [root, joint], skeletons };
}

/** A clip that holds the joint (node 1) at a constant scale on every axis. */
function scaleClip(name: string, scale: number): AnimationClip {
    return {
        name,
        channels: [{ samplerIdx: 0, nodeIdx: 1, path: PATH_SCALE }],
        samplers: [{ input: new Float32Array([0, 1]), output: new Float32Array([scale, scale, scale, scale, scale, scale]), interpolation: INTERP_LINEAR }],
        duration: 1,
        frameRate: 60,
    };
}

/** A clip that animates only the joint's translation, leaving its scale untouched. */
function translationOnlyClip(name: string): AnimationClip {
    return {
        name,
        channels: [{ samplerIdx: 0, nodeIdx: 1, path: PATH_TRANSLATION }],
        samplers: [{ input: new Float32Array([0, 1]), output: new Float32Array([0, 0, 0, 0, 0, 0]), interpolation: INTERP_LINEAR }],
        duration: 1,
        frameRate: 60,
    };
}

function makeGroup(clip: AnimationClip, weight: number, rig: ReturnType<typeof makeRig>): AnimationGroup {
    return {
        name: clip.name,
        duration: clip.duration,
        frameRate: 60,
        isPlaying: true,
        currentFrame: 0,
        speedRatio: 1,
        loopAnimation: true,
        weight,
        _stopped: false,
        _gltfMixer: [clip, rig.nodes, rig.skeletons, [], new Set<number>()],
        _jointNameToIndex: new Map([["joint", 1]]),
    };
}

function makeEngine(): EngineContext {
    return { _device: { queue: { writeTexture: vi.fn() } } } as unknown as EngineContext;
}

/** Length of the matrix's Y basis (column 1) — the joint's world Y scale. */
function scaleY(m: Mat4): number {
    return Math.hypot(m[4]!, m[5]!, m[6]!);
}

describe("weighted glTF blend rest-fill", () => {
    it("eases a node toward its rest scale when only some blended clips animate scale", () => {
        const rig = makeRig();
        // One clip scales the joint to 2; the other animates only its translation, so
        // its scale weight is partial (0.5). With rest-fill the blended scale is
        // 2*0.5 + 1*0.5 = 1.5; without it the scale would collapse to 2*0.5 = 1.0.
        const scaler = makeGroup(scaleClip("scaler", 2), 0.5, rig);
        const mover = makeGroup(translationOnlyClip("mover"), 0.5, rig);
        const manager = createAnimationManager({ engine: makeEngine() });
        addAnimationGroups(manager, [scaler, mover]);
        enableAnimationBlending(manager);

        updateAnimationManager(manager, 16);
        updateAnimationManager(manager, 16);

        const m = getBlendedJointWorldMatrix(scaler, "joint");
        expect(m).not.toBeNull();
        expect(scaleY(m!)).toBeCloseTo(1.5);
    });

    it("leaves a fully-covered node at its weighted scale (rest-fill is a no-op)", () => {
        const rig = makeRig();
        // Both clips animate the joint's scale, so its scale weight is 1 and the
        // rest-fill adds nothing: 2*0.5 + 4*0.5 = 3.
        const a = makeGroup(scaleClip("a", 2), 0.5, rig);
        const b = makeGroup(scaleClip("b", 4), 0.5, rig);
        const manager = createAnimationManager({ engine: makeEngine() });
        addAnimationGroups(manager, [a, b]);
        enableAnimationBlending(manager);

        updateAnimationManager(manager, 16);
        updateAnimationManager(manager, 16);

        const m = getBlendedJointWorldMatrix(a, "joint");
        expect(scaleY(m!)).toBeCloseTo(3);
    });
});
