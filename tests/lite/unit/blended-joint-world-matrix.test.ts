import { describe, expect, it, vi } from "vitest";

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { AnimationGroup } from "../../../packages/babylon-lite/src/animation/animation-group";
import { addAnimationGroups } from "../../../packages/babylon-lite/src/animation/animation-group-task";
import { createAnimationManager, updateAnimationManager } from "../../../packages/babylon-lite/src/animation/animation-manager";
import { enableAnimationBlending, getBlendedJointWorldMatrix } from "../../../packages/babylon-lite/src/animation/weighted-gltf-mixer";
import type { AnimationClip, NodeRest, SkeletonBinding } from "../../../packages/babylon-lite/src/animation/types";
import type { Mat4 } from "../../../packages/babylon-lite/src/math/types";

// prettier-ignore
const IDENTITY = new Float32Array([1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]);

/** A two-node rig: a root and a single "handslot.r" joint translated by (2, 3, 4)
 *  in its rest pose. The mixer pre-multiplies the right-handed → left-handed root
 *  flip (negating X), so the joint's composed world translation is (-2, 3, 4). */
function makeRig(): { nodes: NodeRest[]; skeletons: SkeletonBinding[]; clip: AnimationClip } {
    const root: NodeRest = { parentIdx: -1, tx: 0, ty: 0, tz: 0, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1 };
    const joint: NodeRest = { parentIdx: 0, tx: 2, ty: 3, tz: 4, rx: 0, ry: 0, rz: 0, rw: 1, sx: 1, sy: 1, sz: 1 };
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
    const clip: AnimationClip = { name: "fade", channels: [], samplers: [], duration: 1, frameRate: 60 };
    return { nodes: [root, joint], skeletons, clip };
}

function makeGroup(name: string, weight: number, rig: ReturnType<typeof makeRig>): AnimationGroup {
    return {
        name,
        duration: rig.clip.duration,
        frameRate: 60,
        isPlaying: true,
        currentFrame: 0,
        speedRatio: 1,
        loopAnimation: true,
        weight,
        _stopped: false,
        _gltfMixer: [rig.clip, rig.nodes, rig.skeletons],
        _jointNameToIndex: new Map([["handslot.r", 1]]),
    };
}

function makeEngine(): EngineContext {
    return { _device: { queue: { writeTexture: vi.fn() } } } as unknown as EngineContext;
}

describe("getBlendedJointWorldMatrix", () => {
    it("returns the mixer's blended socket matrix while two clips cross-fade", () => {
        const rig = makeRig();
        const from = makeGroup("from", 0.5, rig);
        const to = makeGroup("to", 0.5, rig);
        const manager = createAnimationManager({ engine: makeEngine() });
        addAnimationGroups(manager, [from, to]);
        enableAnimationBlending(manager);

        // A single update must already produce the rest pose for nodes with no
        // animation channel in this blend. A blend target is created lazily on the
        // first update, after the per-frame rest reset has run, so it must seed its
        // own rest pose on creation — otherwise this joint composes from a zeroed TRS
        // (a degenerate zero-quaternion/zero-scale matrix) for one frame, the
        // one-frame flash on a figure's very first cross-fade.
        updateAnimationManager(manager, 16);

        const m = getBlendedJointWorldMatrix(from, "handslot.r");
        expect(m).not.toBeNull();
        // Rest world = RH→LH(diag −1,1,1) · translate(2,3,4): X negated, translation (−2,3,4).
        expect(m![0]).toBeCloseTo(-1);
        expect(m![5]).toBeCloseTo(1);
        expect(m![10]).toBeCloseTo(1);
        expect(m![12]).toBeCloseTo(-2);
        expect(m![13]).toBeCloseTo(3);
        expect(m![14]).toBeCloseTo(4);
        // Either contributing clip resolves to the same blended figure pose.
        const viaTo = getBlendedJointWorldMatrix(to, "handslot.r");
        expect(viaTo![12]).toBeCloseTo(-2);
    });

    it("returns null in steady state (a single clip at full weight)", () => {
        const rig = makeRig();
        const solo = makeGroup("solo", 1, rig);
        const manager = createAnimationManager({ engine: makeEngine() });
        addAnimationGroups(manager, [solo]);
        enableAnimationBlending(manager);

        updateAnimationManager(manager, 16);

        // Weight 1 with no other contributor is not a blend, so the mixer leaves the
        // figure out of its blended set and the caller falls back to the controller.
        expect(getBlendedJointWorldMatrix(solo, "handslot.r")).toBeNull();
    });

    it("returns null for an unknown joint name during a blend", () => {
        const rig = makeRig();
        const from = makeGroup("from", 0.5, rig);
        const to = makeGroup("to", 0.5, rig);
        const manager = createAnimationManager({ engine: makeEngine() });
        addAnimationGroups(manager, [from, to]);
        enableAnimationBlending(manager);
        updateAnimationManager(manager, 16);

        expect(getBlendedJointWorldMatrix(from, "no.such.joint")).toBeNull();
    });

    it("returns null for a group that was never attached to a blending manager", () => {
        const rig = makeRig();
        const orphan = makeGroup("orphan", 0.5, rig);
        expect(getBlendedJointWorldMatrix(orphan, "handslot.r")).toBeNull();
    });
});
