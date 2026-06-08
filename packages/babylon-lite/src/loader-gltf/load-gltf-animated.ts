/** Cross-file glTF animation retargeting by joint name.
 *
 *  Loads a skinned character glTF plus one or more *animation-library* glTFs
 *  (clips authored on a matching skeleton, e.g. KayKit's `Rig_Medium_*.glb`) and
 *  binds those clips onto the character's own skeleton, returning AnimationGroups
 *  that drive the character. Channels are remapped by node NAME, so the two files
 *  may list their joints in any order as long as the joint names match.
 *
 *  This module is dynamically reachable only through {@link loadGltfWithAnimations}
 *  — scenes that never call it pay zero bytes. It intentionally rebuilds the
 *  character's skeleton "rig" (node hierarchy + per-mesh skeleton bindings) from
 *  the parsed glTF rather than sharing internals with the core animation feature,
 *  so the hot loader path stays untouched.
 */

import type { EngineContext } from "../engine/engine.js";
import type { AssetContainer } from "../asset-container.js";
import type { Mat4 } from "../math/types.js";
import { mat4Invert } from "../math/mat4-invert.js";
import { mat4Identity } from "../math/mat4-identity.js";
import { fetchGltfAsset, loadGltfInternal } from "./load-gltf.js";
import { resolveAccessor, computeNodeWorldMatrix, findParent } from "./gltf-parser.js";
import { createAnimationGroups } from "../animation/animation-group.js";
import type { AnimationGroup } from "../animation/animation-group.js";
import { INTERP_LINEAR, INTERP_STEP, INTERP_CUBICSPLINE, PATH_TRANSLATION, PATH_ROTATION, PATH_SCALE } from "../animation/types.js";
import type { AnimationChannel, AnimationClip, AnimationSampler, GltfAnimationData, NodeRest, SkeletonBinding, AnimatedNodeTarget } from "../animation/types.js";
import type { Mesh } from "../mesh/mesh.js";

const INTERP_MAP: Record<string, 0 | 1 | 2> = { LINEAR: INTERP_LINEAR, STEP: INTERP_STEP, CUBICSPLINE: INTERP_CUBICSPLINE };
const PATH_MAP: Record<string, 0 | 1 | 2> = { translation: PATH_TRANSLATION, rotation: PATH_ROTATION, scale: PATH_SCALE };

/** Resolve a skin's inverse-bind matrices, filling identities when absent. */
function resolveIbms(json: any, binChunk: DataView, skin: any): Float32Array {
    const jointCount = skin.joints.length;
    if (skin.inverseBindMatrices !== undefined) {
        const ibm = resolveAccessor(json, binChunk, skin.inverseBindMatrices);
        return new Float32Array(ibm._data.buffer, ibm._data.byteOffset, jointCount * 16);
    }
    const out = new Float32Array(jointCount * 16);
    for (let i = 0; i < jointCount; i++) {
        const o = i * 16;
        out[o] = out[o + 5] = out[o + 10] = out[o + 15] = 1;
    }
    return out;
}

/** Parsed skeletal rig of a loaded character: node hierarchy + skeleton bindings,
 *  plus a node-name → index map used to retarget clip channels. */
interface SkinnedRig {
    nodes: NodeRest[];
    skeletons: SkeletonBinding[];
    nodeTargets: readonly (AnimatedNodeTarget | undefined)[];
    excludedNodeIndices: ReadonlySet<number>;
    nameToIndex: Map<string, number>;
}

/** Build the character's rig from its parsed glTF + uploaded meshes. Mirrors the
 *  skeleton/hierarchy half of the core animation parser, but works without any
 *  clips (characters ship none) and is only ever bundled with the retarget path. */
function buildSkinnedRig(
    json: any,
    binChunk: DataView,
    meshes: Mesh[],
    parentMap: Map<number, number>,
    worldMatrixCache: Map<number, Mat4>,
    nodeMap: readonly (AnimatedNodeTarget | undefined)[]
): SkinnedRig {
    const nodeCount = json.nodes?.length ?? 0;

    // Rest-pose node hierarchy (TRS + parent), indexed by glTF node index.
    const nodes: NodeRest[] = [];
    const nameToIndex = new Map<string, number>();
    for (let i = 0; i < nodeCount; i++) {
        const n = json.nodes[i];
        const t = n.translation ?? [0, 0, 0];
        const r = n.rotation ?? [0, 0, 0, 1];
        const s = n.scale ?? [1, 1, 1];
        nodes.push({
            parentIdx: findParent(parentMap, i),
            _matrix: n.matrix as Mat4 | undefined,
            tx: t[0],
            ty: t[1],
            tz: t[2],
            rx: r[0],
            ry: r[1],
            rz: r[2],
            rw: r[3],
            sx: s[0],
            sy: s[1],
            sz: s[2],
        });
        if (typeof n.name === "string" && !nameToIndex.has(n.name)) {
            nameToIndex.set(n.name, i);
        }
    }

    // Replay mesh-extraction order so glTF node → uploaded-mesh indices line up.
    const nodeToMeshIndices = new Map<number, number[]>();
    let gpuIdx = 0;
    for (let ni = 0; ni < nodeCount; ni++) {
        const node = json.nodes[ni];
        if (node.mesh === undefined) {
            continue;
        }
        const mesh = json.meshes[node.mesh];
        const indices: number[] = [];
        for (let p = 0; p < mesh.primitives.length; p++) {
            indices.push(gpuIdx++);
        }
        nodeToMeshIndices.set(ni, indices);
    }

    // One SkeletonBinding per skinned mesh primitive, pointing at the character's
    // own GPU bone texture so the controller animates the character directly.
    const skeletons: SkeletonBinding[] = [];
    for (let nodeIdx = 0; nodeIdx < nodeCount; nodeIdx++) {
        const node = json.nodes[nodeIdx];
        if (node.skin === undefined || !json.skins) {
            continue;
        }
        const meshIndices = nodeToMeshIndices.get(nodeIdx);
        if (!meshIndices) {
            continue;
        }
        const skin = json.skins[node.skin];
        const jointNodes: number[] = skin.joints;
        const inverseBindMatrices = resolveIbms(json, binChunk, skin);
        const meshWorldMatrix = computeNodeWorldMatrix(json, nodeIdx, parentMap, worldMatrixCache);
        const invMeshWorld = mat4Invert(meshWorldMatrix) ?? mat4Identity();
        for (const mi of meshIndices) {
            const skeleton = meshes[mi]?.skeleton;
            if (!skeleton) {
                continue;
            }
            skeletons.push({
                jointNodes,
                inverseBindMatrices,
                invMeshWorld,
                boneTexture: skeleton.boneTexture,
                boneCount: jointNodes.length,
                boneMatrices: skeleton.boneMatrices,
                runtimeSkeleton: skeleton,
            });
        }
    }

    // Exclude skin joints + skinned-mesh nodes and their ancestors from node-TRS
    // writeback (they are driven by the skeleton path / bake invMeshWorld at load).
    const excludedNodeIndices = new Set<number>();
    for (const skin of json.skins ?? []) {
        for (const ji of skin.joints ?? []) {
            excludedNodeIndices.add(ji);
        }
    }
    for (let ni = 0; ni < nodeCount; ni++) {
        if (json.nodes[ni]?.skin === undefined) {
            continue;
        }
        let p = ni;
        while (p >= 0 && !excludedNodeIndices.has(p)) {
            excludedNodeIndices.add(p);
            p = findParent(parentMap, p);
        }
    }

    return { nodes, skeletons, nodeTargets: nodeMap ?? [], excludedNodeIndices, nameToIndex };
}

/** Parse the standard TRS animation clips from an animation-library glTF. No
 *  meshes are uploaded — only sampler accessors + channel targets are read. */
function parseClips(json: any, binChunk: DataView): AnimationClip[] {
    const clips: AnimationClip[] = [];
    for (const anim of json.animations ?? []) {
        const samplers: AnimationSampler[] = [];
        for (const s of anim.samplers) {
            const inputAcc = resolveAccessor(json, binChunk, s.input);
            const outputAcc = resolveAccessor(json, binChunk, s.output);
            samplers.push({
                input: new Float32Array(inputAcc._data.buffer, inputAcc._data.byteOffset, inputAcc._count),
                output: new Float32Array(outputAcc._data.buffer, outputAcc._data.byteOffset, outputAcc._count * outputAcc._componentCount),
                interpolation: INTERP_MAP[s.interpolation ?? "LINEAR"] ?? INTERP_LINEAR,
            });
        }
        const channels: AnimationChannel[] = [];
        for (const c of anim.channels) {
            if (c.target.node === undefined) {
                continue;
            }
            const path = PATH_MAP[c.target.path];
            if (path === undefined) {
                continue;
            }
            channels.push({ samplerIdx: c.sampler, nodeIdx: c.target.node, path });
        }
        let duration = 0;
        for (const s of samplers) {
            if (s.input.length > 0) {
                const last = s.input[s.input.length - 1]!;
                if (last > duration) {
                    duration = last;
                }
            }
        }
        clips.push({ name: anim.name ?? "", channels, samplers, duration });
    }
    return clips;
}

/** Remap a source clip's channels onto the target rig by node name. Channels whose
 *  source node name has no match in the target are dropped. Returns null if nothing
 *  mapped (clip doesn't apply to this rig). */
export function retargetClip(clip: AnimationClip, sourceNodeNames: readonly (string | undefined)[], nameToIndex: ReadonlyMap<string, number>): AnimationClip | null {
    const channels: AnimationChannel[] = [];
    for (const ch of clip.channels) {
        const name = sourceNodeNames[ch.nodeIdx];
        const targetIdx = name !== undefined ? nameToIndex.get(name) : undefined;
        if (targetIdx === undefined) {
            continue;
        }
        channels.push({ samplerIdx: ch.samplerIdx, nodeIdx: targetIdx, path: ch.path });
    }
    if (channels.length === 0) {
        return null;
    }
    return { name: clip.name, channels, samplers: clip.samplers, duration: clip.duration };
}

/**
 * Load a skinned character glTF and bind clips from one or more animation-library
 * glTFs onto its skeleton, matching joints by name. Returns the character's
 * {@link AssetContainer} with `animationGroups` populated (one per retargeted
 * clip). All groups start stopped at frame 0 — call {@link playAnimation} on the
 * one you want. `addToScene()` registers them with the scene's animation manager.
 *
 * @param engine - Engine context.
 * @param characterUrl - URL of the skinned character (.glb/.gltf).
 * @param animationUrls - URLs of animation-library glTFs whose clips share the
 *   character's skeleton (by joint name).
 */
export async function loadGltfWithAnimations(engine: EngineContext, characterUrl: string, animationUrls: readonly string[]): Promise<AssetContainer> {
    const target = await loadGltfInternal(engine, characterUrl);
    const rig = buildSkinnedRig(
        target._json,
        target._binChunk,
        target._meshes,
        target._parentMap,
        target._worldMatrixCache,
        target._nodeMap as readonly (AnimatedNodeTarget | undefined)[]
    );

    const clips: AnimationClip[] = [];
    for (const url of animationUrls) {
        const { json, binChunk } = await fetchGltfAsset(url);
        const sourceNodeNames: (string | undefined)[] = (json.nodes ?? []).map((n: any) => (typeof n.name === "string" ? n.name : undefined));
        for (const clip of parseClips(json, binChunk)) {
            const retargeted = retargetClip(clip, sourceNodeNames, rig.nameToIndex);
            if (retargeted) {
                clips.push(retargeted);
            }
        }
    }

    if (clips.length > 0) {
        const data: GltfAnimationData = {
            clips,
            nodes: rig.nodes,
            skeletons: rig.skeletons,
            morphBindings: [],
            nodeTargets: rig.nodeTargets,
            excludedNodeIndices: rig.excludedNodeIndices,
        };
        const groups = createAnimationGroups(data);
        // Start every group stopped so they don't all fight over the shared bone
        // texture; the caller plays exactly one.
        for (const g of groups) {
            g.isPlaying = false;
            g._stopped = true;
        }
        target.container.animationGroups = groups as AnimationGroup[];
    }

    return target.container;
}
