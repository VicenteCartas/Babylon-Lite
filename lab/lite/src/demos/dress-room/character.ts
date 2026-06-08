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

import { addToScene, loadGltf, loadGltfWithAnimations, setSubtreeVisible } from "babylon-lite";
import type { AnimationGroup, EngineContext, Mesh, SceneContext, SceneNode } from "babylon-lite";

/** A selectable character class. */
export interface CharacterClass {
    id: string;
    label: string;
    /** glTF/glb filename under the asset folder. */
    file: string;
    /** Default weapon id (see {@link getWeapons}) this class holds. */
    weapon: string;
}

/** A selectable animation, mapping a friendly label to a KayKit clip name. */
export interface AnimationOption {
    id: string;
    label: string;
    /** KayKit clip name (AnimationGroup.name) to play. */
    clip: string;
}

/** A selectable held weapon. `file` undefined = bare hands. */
export interface WeaponOption {
    id: string;
    label: string;
    /** glTF filename under the weapons folder; undefined leaves the hand empty. */
    file?: string;
    /** Optional grip-orientation correction (Euler XYZ radians) applied between the
     *  hand socket and the weapon. Defaults to {@link DEFAULT_GRIP_EULER}; override
     *  only for props authored on a different axis (e.g. the bow). */
    grip?: readonly [number, number, number];
}

/** A loaded weapon prop, parented to a placement node the demo drives each frame. */
export interface LoadedWeapon {
    id: string;
    roots: SceneNode[];
    setVisible(visible: boolean): void;
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
        { id: "knight", label: "Knight", file: "characters/Knight.glb", weapon: "sword" },
        { id: "barbarian", label: "Barbarian", file: "characters/Barbarian.glb", weapon: "axe" },
        { id: "mage", label: "Mage", file: "characters/Mage.glb", weapon: "staff" },
        { id: "ranger", label: "Ranger", file: "characters/Ranger.glb", weapon: "bow" },
        { id: "rogue", label: "Rogue", file: "characters/Rogue.glb", weapon: "dagger" },
        { id: "rogue_hooded", label: "Rogue (Hooded)", file: "characters/Rogue_Hooded.glb", weapon: "dagger" },
    ];
}

/** Default grip-orientation correction (Euler XYZ radians) for held weapons.
 *
 *  KayKit weapons are authored facing one way down the hand socket, and the
 *  right-handed → left-handed mirror baked into the socket frame flips that
 *  facing. A 180° spin about the weapon's long axis (Y) restores the intended
 *  facing for the pole-shaped props (sword, axe, dagger, staff, wand). It is
 *  invisible on weapons symmetric about that axis and corrects the rest. The bow
 *  is modelled with its limbs along Z rather than Y, so it overrides this. */
export const DEFAULT_GRIP_EULER: readonly [number, number, number] = [0, Math.PI, 0];

/** The weapon roster, in display order. Each is a static KayKit prop held in the
 *  right hand socket (`handslot.r`). */
export function getWeapons(): WeaponOption[] {
    return [
        { id: "none", label: "None" },
        { id: "sword", label: "Sword", file: "weapons/sword_1handed.gltf" },
        { id: "axe", label: "Axe", file: "weapons/axe_1handed.gltf" },
        { id: "greataxe", label: "Great Axe", file: "weapons/axe_2handed.gltf" },
        { id: "dagger", label: "Dagger", file: "weapons/dagger.gltf" },
        { id: "staff", label: "Staff", file: "weapons/staff.gltf" },
        { id: "wand", label: "Wand", file: "weapons/wand.gltf" },
        // The bow is modelled with its limbs along local +Z, whereas the pole
        // weapons run along +Y. A +90° tilt about X lays the bow horizontal
        // (parallel to the ground, like the other weapons), limbs forward, with
        // the riser/grip facing up so it reads correctly through the walk cycle.
        { id: "bow", label: "Bow", file: "weapons/bow.gltf", grip: [Math.PI / 2, 0, 0] },
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

/** Load one weapon prop and parent its roots under `parent` (the placement node
 *  the demo drives from the hand socket each frame). Starts hidden. */
export async function loadWeapon(engine: EngineContext, scene: SceneContext, baseUrl: string, opt: WeaponOption, parent: SceneNode): Promise<LoadedWeapon> {
    const gltf = await loadGltf(engine, baseUrl + opt.file!);
    const roots: SceneNode[] = [];
    for (const entity of gltf.entities) {
        const node = entity as SceneNode;
        node.parent = parent;
        addToScene(scene, node);
        roots.push(node);
        setSubtreeVisible(node, false);
    }
    return {
        id: opt.id,
        roots,
        setVisible: (visible: boolean) => {
            for (const root of roots) {
                setSubtreeVisible(root, visible);
            }
        },
    };
}

