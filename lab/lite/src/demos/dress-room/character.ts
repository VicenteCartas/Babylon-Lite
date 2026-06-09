/** KayKit fantasy races, classes + animations for the dress-room demo.
 *
 *  Each "class" is a self-contained rigged KayKit character (.glb with embedded
 *  texture), grouped under a race: the Human Adventurers (Warrior, Barbarian,
 *  Wizard, Ranger, Rogue) and the Undead Skeletons (Warrior, Mage, Rogue). They
 *  all share one skeleton ("Rig_Medium") whose hand-socket bones (`handslot.l` /
 *  `handslot.r`) are purpose-built mount points for weapons and shields, so gear
 *  and animation work identically across every race and class.
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
    /** Head/headgear variants for this class, toggled by showing/hiding meshes
     *  (see {@link HeadOption}). Omit for classes with no head variants. */
    heads?: HeadOption[];
    /** Default head-variant id; defaults to the first {@link CharacterClass.heads} entry. */
    head?: string;
    /** Optional override of the animation-library files this class loads (defaults
     *  to {@link ANIM_FILES}). The skeleton-rigged undead classes also pull in the
     *  "Special" set for their undead idle / walk / spawn clips. */
    animFiles?: readonly string[];
    /** Optional per-animation clip-name overrides, keyed by animation roster id
     *  (see {@link getAnimations}) or the literal `"spawn"`. Lets a class swap in a
     *  themed variant — e.g. the undead play `Skeletons_Idle` / `Skeletons_Walking`
     *  / `Skeletons_Spawn_Ground` while every other animation falls back to the
     *  shared clip. */
    clipOverride?: Readonly<Record<string, string>>;
}

/** A selectable animation, mapping a friendly label to a KayKit clip name. */
export interface AnimationOption {
    id: string;
    label: string;
    /** KayKit clip name (AnimationGroup.name) to play. Empty when the clip is
     *  resolved at play time from the equipped weapon (see `weaponDriven`). */
    clip: string;
    /** When true, the clip is chosen from the active weapon's hand/kind (the
     *  Attack action: a 1H/2H melee swing, a bow draw, or a spell cast). */
    weaponDriven?: boolean;
    /** When true, the action is only available with a shield in the off-hand
     *  (the Guard block). */
    requiresShield?: boolean;
    /** When true, the clip plays once and settles back into the held animation
     *  (a one-shot attack / dodge) rather than looping. */
    oneShot?: boolean;
}

/** A head/headgear variant for a class. Two flavours:
 *  - **Mesh toggle** (default): `show` lists the head-mesh suffixes to make visible
 *    (the rest of that class's toggleable head meshes are hidden).
 *  - **Model swap**: set `file` to a whole alternate model for this class; the demo
 *    shows that model instead (used for the Rogue's hooded vs unhooded bodies,
 *    where the hood is baked into the body mesh and can't be toggled). */
export interface HeadOption {
    id: string;
    label: string;
    /** Mesh name-suffixes to show for this variant (e.g. `["Head", "Helmet"]`). */
    show: string[];
    /** Whole alternate model file (under the asset folder) for a model-swap variant. */
    file?: string;
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
    /** Optional grip-position offset in the hand-socket frame (rides with the hand
     *  through animation). Used when a prop's pivot is not its grip point — e.g. the
     *  tankard, whose origin is the cup body, is shifted so its handle sits in the hand. */
    offset?: readonly [number, number, number];
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
    /** Head/headgear variants (see {@link CharacterClass.heads}). */
    heads?: HeadOption[];
    setVisible(visible: boolean): void;
}

/** Animation-library glTFs (relative to the asset folder) whose clips are
 *  retargeted onto every character's shared Rig_Medium skeleton. Covers movement,
 *  the weapon-specific melee / ranged / magic attacks, blocking, and emotes. */
const ANIM_FILES = [
    "animations/Rig_Medium_MovementBasic.glb",
    "animations/Rig_Medium_General.glb",
    "animations/Rig_Medium_MovementAdvanced.glb",
    "animations/Rig_Medium_CombatMelee.glb",
    "animations/Rig_Medium_CombatRanged.glb",
    "animations/Rig_Medium_Simulation.glb",
];

/** A playable race. Each race offers its own set of {@link CharacterClass}es;
 *  the dress-room's Race picker selects the race and the Class picker then offers
 *  only that race's classes. */
export interface Race {
    id: string;
    label: string;
    classes: CharacterClass[];
}

/** Animation overrides shared by every undead (skeleton) class: they load the
 *  "Special" library and play its skeletal idle / walk / spawn instead of the
 *  human clips; everything else falls back to the shared clips. */
const UNDEAD_ANIM: Pick<CharacterClass, "animFiles" | "clipOverride"> = {
    animFiles: [...ANIM_FILES, "animations/Rig_Medium_Special.glb"],
    clipOverride: { idle: "Skeletons_Idle", walk: "Skeletons_Walking", spawn: "Skeletons_Spawn_Ground" },
};

/** The playable races and their classes, in display order. Humans are the KayKit
 *  Adventurers; the undead are the KayKit Skeletons, which share the same
 *  Rig_Medium skeleton and hand sockets, so weapons, off-hands, and the animation
 *  retargeting all work on them unchanged. */
export function getRaces(): Race[] {
    return [
        {
            id: "human",
            label: "Human",
            classes: [
                {
                    id: "warrior",
                    label: "Warrior",
                    file: "characters/Knight.glb",
                    weapon: "sword",
                    offhand: "shield_round",
                    heads: [
                        { id: "fullhelm", label: "Full Helm", show: ["Head", "Helmet", "HelmetVisor"] },
                        { id: "openhelm", label: "Open Helm", show: ["Head", "Helmet"] },
                        { id: "bare", label: "Bareheaded", show: ["Head"] },
                    ],
                },
                {
                    id: "barbarian",
                    label: "Barbarian",
                    file: "characters/Barbarian.glb",
                    weapon: "axe",
                    offhand: "shield_spikes",
                    heads: [
                        { id: "bearhat", label: "Bear Hood", show: ["Head", "BearHat"] },
                        { id: "bare", label: "Bareheaded", show: ["Head"] },
                    ],
                },
                {
                    id: "wizard",
                    label: "Wizard",
                    file: "characters/Mage.glb",
                    weapon: "staff",
                    offhand: "none",
                    heads: [
                        { id: "hat", label: "Wizard Hat", show: ["Head", "Hat"] },
                        { id: "bare", label: "Bareheaded", show: ["Head"] },
                    ],
                },
                { id: "ranger", label: "Ranger", file: "characters/Ranger.glb", weapon: "bow", offhand: "quiver" },
                // The hooded rogue's head variants are whole-model swaps (the hood is
                // baked into the body mesh), so each option carries a `file`.
                {
                    id: "rogue",
                    label: "Rogue",
                    file: "characters/Rogue_Hooded.glb",
                    weapon: "dagger",
                    offhand: "none",
                    heads: [
                        { id: "hooded", label: "Hooded", show: [], file: "characters/Rogue_Hooded.glb" },
                        { id: "unhooded", label: "Unhooded", show: [], file: "characters/Rogue.glb" },
                    ],
                },
            ],
        },
        {
            id: "undead",
            label: "Undead",
            classes: [
                // The skeletons keep a separate Head (skull) mesh from their headgear,
                // so a bare skull is a simple mesh toggle (no model swap needed).
                {
                    id: "undead_warrior",
                    label: "Warrior",
                    file: "characters/Skeleton_Warrior.glb",
                    weapon: "sword",
                    offhand: "shield_round",
                    ...UNDEAD_ANIM,
                    heads: [
                        { id: "helm", label: "Helm", show: ["Helmet"] },
                        { id: "bare", label: "Bare Skull", show: [] },
                    ],
                },
                {
                    id: "undead_mage",
                    label: "Mage",
                    file: "characters/Skeleton_Mage.glb",
                    weapon: "wand",
                    offhand: "spellbook",
                    ...UNDEAD_ANIM,
                    heads: [
                        { id: "hat", label: "Witch Hat", show: ["Hat"] },
                        { id: "bare", label: "Bare Skull", show: [] },
                    ],
                },
                {
                    id: "undead_rogue",
                    label: "Rogue",
                    file: "characters/Skeleton_Rogue.glb",
                    weapon: "dagger",
                    offhand: "none",
                    ...UNDEAD_ANIM,
                    heads: [
                        { id: "hood", label: "Hood", show: ["Hood"] },
                        { id: "bare", label: "Bare Skull", show: [] },
                    ],
                },
            ],
        },
    ];
}

/** Every character class across all races, flattened — the demo preloads them all
 *  (hidden) and the Race / Class pickers select which is shown. */
export function getClasses(): CharacterClass[] {
    return getRaces().flatMap((r) => r.classes);
}

/** Apply a head variant to a loaded character by toggling its head meshes. Safe
 *  to call only while the character is visible (it explicitly shows/hides meshes;
 *  `setVisible(true)` resets them, so re-apply the head after showing).
 *
 *  The loader names mesh nodes generically (`gltf_mesh_N`) but keeps each mesh
 *  under a parent TransformNode carrying the real glTF node name (e.g.
 *  `Knight_Helmet`), so the variant's mesh suffixes are matched against that
 *  parent name's last `_`-segment. */
export function applyHead(character: LoadedCharacter, headId: string): void {
    const heads = character.heads;
    if (!heads || heads.length === 0) {
        return;
    }
    const option = heads.find((h) => h.id === headId) ?? heads[0]!;
    const toggleable = new Set<string>();
    for (const h of heads) {
        for (const s of h.show) {
            toggleable.add(s);
        }
    }
    for (const mesh of character.meshes) {
        const parentName = (mesh as unknown as { parent?: { name?: string } }).parent?.name ?? mesh.name;
        const seg = parentName.slice(parentName.lastIndexOf("_") + 1);
        if (!toggleable.has(seg)) {
            continue;
        }
        setSubtreeVisible(mesh as unknown as SceneNode, option.show.includes(seg));
    }
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
 *  the left hand socket (`handslot.l`). Shields enable the Guard animation.
 *
 *  Shields are modelled as a disc/plate in their local XY plane with the face
 *  pointing along local +Z. The default off-hand grip stands a prop upright but
 *  leaves that face pointing inward, across the body; the shields override the
 *  grip so the face points out to the side, away from the body, as a shield
 *  carried on the forearm would, and push the plate outward along its face normal
 *  so the hand grips its back instead of the centre (otherwise the fist clips
 *  through the front). The tankard's pivot is its cup body rather than its handle,
 *  so it carries an offset that slides the handle into the hand while the cup
 *  hangs outward. */
export function getOffhands(): OffhandOption[] {
    const shieldGrip = [0, 0, Math.PI / 2] as const;
    // Push the plate out along its face normal (the grip's local +Z) so the hand
    // sits at the back of the shield rather than its centre.
    const shieldOffset = [0, 0, 0.15] as const;
    return [
        { id: "none", label: "None" },
        { id: "shield_round", label: "Round Shield", file: "weapons/shield_round.gltf", grip: shieldGrip, offset: shieldOffset, kind: "shield" },
        { id: "shield_square", label: "Kite Shield", file: "weapons/shield_square.gltf", grip: shieldGrip, offset: shieldOffset, kind: "shield" },
        { id: "shield_spikes", label: "Spiked Shield", file: "weapons/shield_spikes.gltf", grip: shieldGrip, offset: shieldOffset, kind: "shield" },
        { id: "shield_badge", label: "Crest Shield", file: "weapons/shield_badge.gltf", grip: shieldGrip, offset: shieldOffset, kind: "shield" },
        { id: "spellbook", label: "Spellbook", file: "weapons/spellbook_open.gltf", kind: "item" },
        { id: "quiver", label: "Quiver", file: "weapons/quiver.gltf", kind: "item" },
        { id: "mug", label: "Tankard", file: "weapons/mug_full.gltf", offset: [0, 0.071, 0.26], kind: "item" },
    ];
}

/** The animation roster, in display order. `clip` must match a KayKit clip name,
 *  except the weapon-driven Attack (resolved from the equipped weapon) and the
 *  Guard, which is only offered when a shield is in the off-hand. */
export function getAnimations(): AnimationOption[] {
    return [
        { id: "idle", label: "Idle", clip: "Idle_A" },
        { id: "walk", label: "Walk", clip: "Walking_A" },
        { id: "dodge", label: "Dodge", clip: "Dodge_Backward", oneShot: true },
        { id: "attack", label: "Attack", clip: "", weaponDriven: true, oneShot: true },
        { id: "guard", label: "Guard", clip: "Melee_Blocking", requiresShield: true },
        { id: "cheer", label: "Cheer", clip: "Cheering" },
        { id: "wave", label: "Wave", clip: "Waving" },
    ];
}

/** Resolve the Attack clip for a weapon's hand + kind (see {@link WeaponOption}).
 *  Bare hands punch; melee weapons swing 1- or 2-handed; bows draw; staves and
 *  wands cast. */
export function attackClipFor(hand: WeaponHand | undefined, kind: WeaponKind | undefined): string {
    if (kind === "ranged") {
        return "Ranged_Bow_Draw";
    }
    if (kind === "magic") {
        return "Ranged_Magic_Spellcasting";
    }
    if (kind === "melee") {
        return hand === "2h" ? "Melee_2H_Attack_Chop" : "Melee_1H_Attack_Slice_Diagonal";
    }
    return "Melee_Unarmed_Attack_Punch_A";
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
 *  return a toggleable handle. All animation groups start stopped.
 *
 *  Only the renderable entities are added to the scene; the animation groups are
 *  driven by a caller-owned {@link createAnimationManager} (so the demo can
 *  cross-fade between clips), not by `addToScene`'s built-in per-container ticker
 *  — registering both would advance every clip twice per frame. */
export async function loadCharacter(engine: EngineContext, scene: SceneContext, baseUrl: string, cls: CharacterClass): Promise<LoadedCharacter> {
    const animFiles = cls.animFiles ?? ANIM_FILES;
    const container = await loadGltfWithAnimations(
        engine,
        baseUrl + cls.file,
        animFiles.map((f) => baseUrl + f)
    );
    for (const entity of container.entities) {
        addToScene(scene, entity);
    }
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
        heads: cls.heads,
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

