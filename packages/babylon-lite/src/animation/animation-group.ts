// AnimationGroup — user-facing handle for a single animation clip.
// Stored on scene.animationGroups[]. Pure state interface.

import type { EngineContext } from "../engine/engine.js";
import type { Mat4 } from "../math/types.js";
import type { AnimatedNodeTarget, AnimationClip, AnimationSampler, GltfAnimationData, NodeRest, SkeletonBinding } from "./types.js";
import { PATH_POINTER, PATH_TRANSLATION, PATH_ROTATION, PATH_SCALE } from "./types.js";
import { createAnimationController } from "../skeleton/skeleton-updater.js";
import type { AnimationController } from "../skeleton/skeleton-updater.js";

const DEFAULT_FRAME_RATE = 60;

export interface AnimationPropertyRuntimeTrack {
    readonly sampler: AnimationSampler;
    readonly stride: number;
    readonly quaternion: boolean;
    readonly writer: (output: Float32Array, offset: number) => void;
    readonly mixTarget: object;
    readonly mixProperty: string;
}
export type AnimationPropertyMixer = readonly [readonly AnimationPropertyRuntimeTrack[], number, number, number];
/** glTF skeleton mixer state: `[clip, nodes, skeletons, nodeTargets, excludedNodeIndices]`.
 *  The trailing two carry the node-TRS writeback targets so the weighted blend
 *  path can drive non-skinned meshes parented to a bone (e.g. a static helmet or
 *  cape) the same way the solo controller does. */
export type AnimationGltfMixer = readonly [AnimationClip, readonly NodeRest[], readonly SkeletonBinding[], readonly (AnimatedNodeTarget | undefined)[], ReadonlySet<number>];
export interface AnimationAdditiveMixer {
    readonly referenceTime: number;
}

/** User-facing animation group — one per animation clip. Pure state. */
export interface AnimationGroup {
    /** Name of this animation. */
    readonly name: string;
    /** Duration in seconds. */
    readonly duration: number;
    /** Frame rate used by goToFrame(). */
    readonly frameRate?: number;
    /** True if currently playing. */
    isPlaying: boolean;
    /** Current playback time in seconds. */
    currentFrame: number;
    /** Playback speed multiplier (default 1). */
    speedRatio: number;
    /** Whether animation loops (default true). */
    loopAnimation: boolean;
    /** Weighted contribution used by AnimationManager mixing (default 1). */
    weight: number;
    /** @internal Debug: internal animation controller. */
    readonly _ctrl?: AnimationController;
    /** @internal Manual property animation metadata used by the optional weighted mixer. */
    _propertyMixer?: AnimationPropertyMixer;
    /** @internal glTF skeleton metadata used by the optional weighted mixer. */
    _gltfMixer?: AnimationGltfMixer;
    /** @internal Additive animation metadata used by the optional blending mixer. */
    _additive?: AnimationAdditiveMixer;
    /** @internal Whether stop() was called (suppresses tickAnimation). */
    _stopped: boolean;
    /** @internal Joint name → node index, for resolving an animated joint's world
     *  transform (e.g. attaching a held prop to a hand socket). Set by loaders that
     *  know the rig's joint names. */
    _jointNameToIndex?: ReadonlyMap<string, number>;
}

/** Start playing an animation group. */
export function playAnimation(group: AnimationGroup): void {
    group.isPlaying = true;
    group._stopped = false;
}

/** Pause playback of an animation group. */
export function pauseAnimation(group: AnimationGroup): void {
    group.isPlaying = false;
}

/** Stop playback and reset to frame 0. */
export function stopAnimation(group: AnimationGroup): void {
    group.isPlaying = false;
    group.currentFrame = 0;
    group._stopped = true;
}

/** Seek to a specific frame, apply the pose, and pause. */
export function goToFrame(group: AnimationGroup, frame: number, engine?: EngineContext): void {
    const ctrl = group._ctrl;
    group.currentFrame = frame / (group.frameRate || DEFAULT_FRAME_RATE);
    group.isPlaying = false;
    if (ctrl) {
        syncControllerFromGroup(group, ctrl);
        if (engine || !group._stopped || !group._gltfMixer) {
            ctrl.tick(0, engine);
            group.currentFrame = ctrl.time;
        }
    }
}

/** @internal Advance animation by deltaMs. Called by the engine each frame. */
export function tickAnimation(group: AnimationGroup, deltaMs: number, engine?: EngineContext): void {
    if (!group._stopped && group._ctrl) {
        syncControllerFromGroup(group, group._ctrl);
        group._ctrl.tick(deltaMs, engine);
        group.currentFrame = group._ctrl.time;
    }
}

function syncControllerFromGroup(group: AnimationGroup, ctrl: AnimationController): void {
    ctrl.time = group.currentFrame;
    ctrl.playing = group.isPlaying;
    ctrl.speedRatio = group.speedRatio;
    ctrl.loop = group.loopAnimation;
}

/** Read an animated joint's local-to-asset world matrix (column-major), or null
 *  when unavailable.
 *
 *  The matrix is in the animation's own space — i.e. relative to the asset's
 *  synthetic root — so to position a prop in world space, multiply the owning
 *  asset root's world matrix by this (`mat4Multiply(rootWorld, jointMatrix)`).
 *  Returns null when the group has no controller, no joint-name map, or the joint
 *  name is unknown. Requires the group to have been played + ticked at least once;
 *  a stopped group's world matrices are stale.
 *
 *  Primarily used to attach a held prop (weapon, shield) to a hand-socket bone:
 *  resolve the socket joint here each frame, compose with the character root, and
 *  drive the prop's transform. */
export function getJointWorldMatrix(group: AnimationGroup, jointName: string): Mat4 | null {
    const idx = group._jointNameToIndex?.get(jointName);
    const worldMat = group._ctrl?._debugWorldMat;
    if (idx === undefined || !worldMat) {
        return null;
    }
    const off = idx * 16;
    if (off + 16 > worldMat.length) {
        return null;
    }
    const out = new Float32Array(16);
    for (let i = 0; i < 16; i++) {
        out[i] = worldMat[off + i]!;
    }
    return out as unknown as Mat4;
}

/** Create AnimationGroup(s) from parsed glTF animation data.
 *  Returns one group per animation clip. */
export function createAnimationGroups(animData: GltfAnimationData): AnimationGroup[] {
    const { clips, nodes, skeletons, morphBindings, nodeTargets, excludedNodeIndices } = animData;
    const hasPointer = clips.some((c) => c.channels.some((ch) => ch.path === PATH_POINTER));
    const hasNodeWriteback = clips.some((c) =>
        c.channels.some(
            (ch) =>
                (ch.path === PATH_TRANSLATION || ch.path === PATH_ROTATION || ch.path === PATH_SCALE) &&
                ch.nodeIdx >= 0 &&
                !excludedNodeIndices.has(ch.nodeIdx) &&
                !!nodeTargets[ch.nodeIdx]
        )
    );
    if (clips.length === 0 || (skeletons.length === 0 && morphBindings.length === 0 && !hasPointer && !hasNodeWriteback)) {
        return [];
    }

    return clips.map((clip, clipIndex) => {
        const ctrl: AnimationController = createAnimationController(clip, nodes, skeletons, morphBindings, nodeTargets, excludedNodeIndices);
        const group: AnimationGroup = {
            name: clip.name || `animation_${clipIndex}`,
            duration: clip.duration,
            frameRate: clip.frameRate || DEFAULT_FRAME_RATE,
            isPlaying: true,
            currentFrame: 0,
            speedRatio: 1,
            loopAnimation: true,
            weight: 1,
            _ctrl: ctrl,
            _stopped: false,
        };
        if (skeletons[0]) {
            group._gltfMixer = [clip, nodes, skeletons, nodeTargets, excludedNodeIndices];
        }
        return group;
    });
}
