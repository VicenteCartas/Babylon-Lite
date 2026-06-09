import { describe, expect, it, vi } from "vitest";

import type { EngineContext } from "../../../packages/babylon-lite/src/engine/engine";
import type { AnimationGroup } from "../../../packages/babylon-lite/src/animation/animation-group";
import { addAnimationGroups } from "../../../packages/babylon-lite/src/animation/animation-group-task";
import { createAnimationManager, updateAnimationManager } from "../../../packages/babylon-lite/src/animation/animation-manager";
import { enableAnimationBlending } from "../../../packages/babylon-lite/src/animation/weighted-gltf-mixer";
import type { AnimatedNodeTarget, AnimationClip, NodeRest, SkeletonBinding } from "../../../packages/babylon-lite/src/animation/types";
import { INTERP_LINEAR, PATH_TRANSLATION } from "../../../packages/babylon-lite/src/animation/types";
import type { Mat4 } from "../../../packages/babylon-lite/src/math/types";

// prettier-ignore
const IDENTITY = new Float32Array([1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1]);

/** A scene-node target that records the latest TRS written to it. */
function makeNodeTarget(): AnimatedNodeTarget & { pos: number[]; scl: number[] } {
    const pos = [0, 0, 0];
    const scl = [1, 1, 1];
    return {
        pos,
        scl,
        position: { set: (x: number, y: number, z: number) => ((pos[0] = x), (pos[1] = y), (pos[2] = z)) },
        rotationQuaternion: { set: () => {} },
        scaling: { set: (x: number, y: number, z: number) => ((scl[0] = x), (scl[1] = y), (scl[2] = z)) },
    };
}

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

/** A clip that holds the joint (node 1) at a constant Y translation. */
function translateYClip(name: string, ty: number): AnimationClip {
    return {
        name,
        channels: [{ samplerIdx: 0, nodeIdx: 1, path: PATH_TRANSLATION }],
        samplers: [{ input: new Float32Array([0, 1]), output: new Float32Array([0, ty, 0, 0, ty, 0]), interpolation: INTERP_LINEAR }],
        duration: 1,
        frameRate: 60,
    };
}

function makeGroup(
    clip: AnimationClip,
    weight: number,
    rig: ReturnType<typeof makeRig>,
    nodeTargets: readonly (AnimatedNodeTarget | undefined)[],
    excluded: ReadonlySet<number>
): AnimationGroup {
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
        _gltfMixer: [clip, rig.nodes, rig.skeletons, nodeTargets, excluded],
    };
}

function makeEngine(): EngineContext {
    return { _device: { queue: { writeTexture: vi.fn() } } } as unknown as EngineContext;
}

describe("weighted glTF blend node writeback", () => {
    it("writes the blended joint TRS back to its scene-node target during a blend", () => {
        const rig = makeRig();
        const jointTarget = makeNodeTarget();
        const targets = [undefined, jointTarget];
        // Two clips translate the joint to Y=2 and Y=4 at weight 0.5 each → blended
        // Y=3. A non-skinned mesh parented to this bone needs the scene node to carry
        // that blended Y, so it follows the body through the cross-fade.
        const a = makeGroup(translateYClip("a", 2), 0.5, rig, targets, new Set<number>());
        const b = makeGroup(translateYClip("b", 4), 0.5, rig, targets, new Set<number>());
        const manager = createAnimationManager({ engine: makeEngine() });
        addAnimationGroups(manager, [a, b]);
        enableAnimationBlending(manager);

        updateAnimationManager(manager, 16);
        updateAnimationManager(manager, 16);

        expect(jointTarget.pos[1]).toBeCloseTo(3);
    });

    it("does not write an excluded node back", () => {
        const rig = makeRig();
        const jointTarget = makeNodeTarget();
        const targets = [undefined, jointTarget];
        // Same blend, but the joint is excluded (e.g. an ancestor of a skinned mesh),
        // so the writeback skips it and its target stays at rest (Y=0).
        const a = makeGroup(translateYClip("a", 2), 0.5, rig, targets, new Set<number>([1]));
        const b = makeGroup(translateYClip("b", 4), 0.5, rig, targets, new Set<number>([1]));
        const manager = createAnimationManager({ engine: makeEngine() });
        addAnimationGroups(manager, [a, b]);
        enableAnimationBlending(manager);

        updateAnimationManager(manager, 16);
        updateAnimationManager(manager, 16);

        expect(jointTarget.pos[1]).toBe(0);
    });
});
