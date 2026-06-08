/** KayKit fantasy character classes + animations for the dress-room demo.
 *
 *  Each "class" is a self-contained rigged KayKit character (.glb with embedded
 *  texture): Knight, Barbarian, Mage, Ranger, Rogue. They share one skeleton
 *  ("Rig_Medium") whose hand-socket bones (`handslot.l` / `handslot.r`) are
 *  purpose-built mount points for weapons and shields.
 *
 *  The characters ship no clips of their own; animation comes from KayKit's
 *  separate animation-library glTFs, retargeted onto each character's skeleton by
 *  joint name via `loadGltfWithAnimations`.
 *
 *  Art: "KayKit - Adventurers" by Kay Lousberg (https://kaylousberg.itch.io),
 *  released under CC0 1.0 (public domain). Assets are committed (downscaled)
 *  under lab/public/dress-room/ and copied next to the demo bundle at build
 *  time, so they load relative to the page. */

import { addToScene, loadGltfWithAnimations, setSubtreeVisible } from "babylon-lite";
import type { AnimationGroup, EngineContext, Mesh, SceneContext, SceneNode } from "babylon-lite";

/** A selectable character class. */
export interface CharacterClass {
    id: string;
    label: string;
    /** glTF/glb filename under the asset folder. */
    file: string;
}

/** A selectable animation, mapping a friendly label to a KayKit clip name. */
export interface AnimationOption {
    id: string;
    label: string;
    /** KayKit clip name (AnimationGroup.name) to play. */
    clip: string;
}

/** A loaded, placed character with its retargeted animation groups. */
export interface LoadedCharacter {
    id: string;
    /** Root nodes added to the scene. */
    roots: SceneNode[];
    /** Every renderable mesh (used as shadow casters). */
    meshes: Mesh[];
    /** glTF node name → SceneNode, for finding hand sockets (`handslot.r`, …). */
    nodeByName: Map<string, SceneNode>;
    /** Clip name → AnimationGroup (all start stopped). */
    groups: Map<string, AnimationGroup>;
    setVisible(visible: boolean): void;
}

/** Animation-library glTFs (relative to the asset folder) whose clips are
 *  retargeted onto every character's shared Rig_Medium skeleton. */
const ANIM_FILES = ["animations/Rig_Medium_MovementBasic.glb", "animations/Rig_Medium_General.glb"];

/** The character roster, in display order. */
export function getClasses(): CharacterClass[] {
    return [
        { id: "knight", label: "Knight", file: "characters/Knight.glb" },
        { id: "barbarian", label: "Barbarian", file: "characters/Barbarian.glb" },
        { id: "mage", label: "Mage", file: "characters/Mage.glb" },
        { id: "ranger", label: "Ranger", file: "characters/Ranger.glb" },
        { id: "rogue", label: "Rogue", file: "characters/Rogue.glb" },
        { id: "rogue_hooded", label: "Rogue (Hooded)", file: "characters/Rogue_Hooded.glb" },
    ];
}

/** The animation roster, in display order. `clip` must match a KayKit clip name. */
export function getAnimations(): AnimationOption[] {
    return [
        { id: "idle", label: "Idle", clip: "Idle_A" },
        { id: "walk", label: "Walk", clip: "Walking_A" },
        { id: "run", label: "Run", clip: "Running_A" },
        { id: "jump", label: "Jump", clip: "Jump_Idle" },
        { id: "hit", label: "Hit", clip: "Hit_A" },
        { id: "throw", label: "Throw", clip: "Throw" },
    ];
}

/** Walk a node subtree, collecting renderable meshes and a name→node index. */
function indexSubtree(roots: readonly SceneNode[]): { meshes: Mesh[]; nodeByName: Map<string, SceneNode> } {
    const meshes: Mesh[] = [];
    const nodeByName = new Map<string, SceneNode>();
    const stack: SceneNode[] = [...roots];
    while (stack.length) {
        const node = stack.pop()!;
        if (node.name && !nodeByName.has(node.name)) {
            nodeByName.set(node.name, node);
        }
        if ((node as Mesh).material) {
            meshes.push(node as Mesh);
        }
        if (node.children?.length) {
            stack.push(...node.children);
        }
    }
    return { meshes, nodeByName };
}

/** Load one character glb with retargeted animations, add it to the scene, and
 *  return a toggleable handle. All animation groups start stopped. */
export async function loadCharacter(engine: EngineContext, scene: SceneContext, baseUrl: string, cls: CharacterClass): Promise<LoadedCharacter> {
    const container = await loadGltfWithAnimations(
        engine,
        baseUrl + cls.file,
        ANIM_FILES.map((f) => baseUrl + f)
    );
    addToScene(scene, container);
    const roots = container.entities as SceneNode[];
    const { meshes, nodeByName } = indexSubtree(roots);
    const groups = new Map<string, AnimationGroup>();
    for (const g of container.animationGroups ?? []) {
        groups.set(g.name, g);
    }
    return {
        id: cls.id,
        roots,
        meshes,
        nodeByName,
        groups,
        setVisible: (visible: boolean) => {
            for (const root of roots) {
                setSubtreeVisible(root, visible);
            }
        },
    };
}
