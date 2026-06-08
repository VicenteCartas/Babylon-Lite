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
    /** Default off-hand item id (see {@link getOffhands}); defaults to `"none"`. */
    offhand?: string;
    /** Optional override of the animation-library files this class loads (defaults
     *  to {@link ANIM_FILES}). The skeleton-rigged necromancer also pulls in the
     *  "Special" set for its undead idle / walk / spawn clips. */
    animFiles?: readonly string[];
    /** Optional per-animation clip-name overrides, keyed by animation roster id
     *  (see {@link getAnimations}) or the literal `"spawn"`. Lets a class swap in a
     *  themed variant — e.g. the necromancer plays `Skeletons_Idle` /
     *  `Skeletons_Walking` / `Skeletons_Spawn_Ground` while every other animation
     *  falls back to the shared clip. */
    clipOverride?: Readonly<Record<string, string>>;
}

/** A selectable animation, mapping a friendly label to a KayKit clip name. */
export interface AnimationOption {
    id: string;
    label: string;
    /** KayKit clip name (AnimationGroup.name) to play. */
    clip: string;
}

/** What hand(s) a weapon occupies and how it is wielded — used to resolve the
 *  equipment-driven Attack/Guard animations (a 2H weapon precludes an off-hand). */
export type WeaponHand = "1h" | "2h";
export type WeaponKind = "melee" | "ranged" | "magic";

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
    /** One- or two-handed (a 2H weapon leaves no free off-hand). */
    hand?: WeaponHand;
    /** How it attacks — selects the melee / ranged / magic attack clip. */
    kind?: WeaponKind;
}

/** A selectable off-hand item held in the left hand (`handslot.l`): a shield or a
 *  thematic prop (spellbook, quiver, mug). `file` undefined = empty off-hand. */
export interface OffhandOption {
    id: string;
    label: string;
    /** glTF filename under the weapons folder; undefined leaves the off-hand empty. */
    file?: string;
    /** Optional grip-orientation correction (Euler XYZ radians), as for weapons. */
    grip?: readonly [number, number, number];
    /** A shield enables the Guard animation; plain items do not. */
    kind?: "shield" | "item";
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
    /** Per-animation clip-name overrides (see {@link CharacterClass.clipOverride}). */
    clipOverride?: Readonly<Record<string, string>>;
    setVisible(visible: boolean): void;
}

/** Animation-library glTFs (relative to the asset folder) whose clips are
 *  retargeted onto every character's shared Rig_Medium skeleton. */
const ANIM_FILES = ["animations/Rig_Medium_MovementBasic.glb", "animations/Rig_Medium_General.glb"];

/** The character roster, in display order. */
export function getClasses(): CharacterClass[] {
    return [
        { id: "knight", label: "Knight", file: "characters/Knight.glb", weapon: "sword", offhand: "shield_round" },
        { id: "barbarian", label: "Barbarian", file: "characters/Barbarian.glb", weapon: "axe", offhand: "shield_spikes" },
        { id: "mage", label: "Mage", file: "characters/Mage.glb", weapon: "staff", offhand: "none" },
        { id: "ranger", label: "Ranger", file: "characters/Ranger.glb", weapon: "bow", offhand: "quiver" },
        // The "rogue" id maps to KayKit's hooded rogue model (the plain rogue was
        // dropped in favour of the necromancer, keeping the roster at six).
        { id: "rogue", label: "Rogue", file: "characters/Rogue_Hooded.glb", weapon: "dagger", offhand: "none" },
        // Necromancer = KayKit Skeletons "Skeleton Mage". It shares the Rig_Medium
        // skeleton + hand sockets, so it uses the same animation library and weapon
        // attachment as every other class. It also loads the "Special" set and maps
        // idle / walk / spawn to its skeletal (undead) variants; run / jump / hit /
        // throw have no special variant and fall back to the shared clips.
        {
            id: "necromancer",
            label: "Necromancer",
            file: "characters/Necromancer.glb",
            weapon: "wand",
            offhand: "spellbook",
            animFiles: [...ANIM_FILES, "animations/Rig_Medium_Special.glb"],
            clipOverride: { idle: "Skeletons_Idle", walk: "Skeletons_Walking", spawn: "Skeletons_Spawn_Ground" },
        },
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
        { id: "sword", label: "Sword", file: "weapons/sword_1handed.gltf", hand: "1h", kind: "melee" },
        { id: "axe", label: "Axe", file: "weapons/axe_1handed.gltf", hand: "1h", kind: "melee" },
        { id: "greataxe", label: "Great Axe", file: "weapons/axe_2handed.gltf", hand: "2h", kind: "melee" },
        { id: "dagger", label: "Dagger", file: "weapons/dagger.gltf", hand: "1h", kind: "melee" },
        { id: "staff", label: "Staff", file: "weapons/staff.gltf", hand: "2h", kind: "magic" },
        { id: "wand", label: "Wand", file: "weapons/wand.gltf", hand: "1h", kind: "magic" },
        // The bow is modelled with its limbs along local +Z, whereas the pole
        // weapons run along +Y. A +90° tilt about X lays the bow horizontal
        // (parallel to the ground, like the other weapons), limbs forward, with
        // the riser/grip facing up so it reads correctly through the walk cycle.
        { id: "bow", label: "Bow", file: "weapons/bow.gltf", grip: [Math.PI / 2, 0, 0], hand: "2h", kind: "ranged" },
    ];
}

/** The off-hand roster, in display order. Each is a static KayKit prop held in
 *  the left hand socket (`handslot.l`). Shields enable the Guard animation. */
export function getOffhands(): OffhandOption[] {
    return [
        { id: "none", label: "None" },
        { id: "shield_round", label: "Round Shield", file: "weapons/shield_round.gltf", kind: "shield" },
        { id: "shield_square", label: "Kite Shield", file: "weapons/shield_square.gltf", kind: "shield" },
        { id: "shield_spikes", label: "Spiked Shield", file: "weapons/shield_spikes.gltf", kind: "shield" },
        { id: "shield_badge", label: "Crest Shield", file: "weapons/shield_badge.gltf", kind: "shield" },
        { id: "spellbook", label: "Spellbook", file: "weapons/spellbook_open.gltf", kind: "item" },
        { id: "quiver", label: "Quiver", file: "weapons/quiver.gltf", kind: "item" },
        { id: "mug", label: "Tankard", file: "weapons/mug_full.gltf", kind: "item" },
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
    const animFiles = cls.animFiles ?? ANIM_FILES;
    const container = await loadGltfWithAnimations(
        engine,
        baseUrl + cls.file,
        animFiles.map((f) => baseUrl + f)
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
        clipOverride: cls.clipOverride,
        setVisible: (visible: boolean) => {
            for (const root of roots) {
                setSubtreeVisible(root, visible);
            }
        },
    };
}

/** Load one held prop (weapon or off-hand item) and parent its roots under
 *  `parent` (the placement node the demo drives from a hand socket each frame).
 *  Starts hidden. */
export async function loadWeapon(engine: EngineContext, scene: SceneContext, baseUrl: string, opt: { id: string; file?: string }, parent: SceneNode): Promise<LoadedWeapon> {
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

