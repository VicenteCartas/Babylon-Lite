/** Dress-Room Demo — a fantasy character dresser using CC0 KayKit art.
 *
 *  A rigged adventurer stands on a turntable pedestal inside a switchable 3D
 *  environment. The control panel lets you pick a character class (Knight,
 *  Barbarian, Mage, Ranger, Rogue) and the surrounding scene. All classes share
 *  one skeleton with hand-socket bones, so held gear (added in a later slice)
 *  mounts to the same sockets on every class.
 *
 *  Art: "KayKit - Adventurers" and "KayKit - Dungeon Remastered" by Kay Lousberg
 *  (https://kaylousberg.itch.io), released under CC0 1.0 (public domain).
 *  Downscaled copies are committed under lab/public/dress-room/. Characters are
 *  shown in their rest (bind) pose; animation arrives in a later slice. */

import {
    attachControl,
    createArcRotateCamera,
    createDirectionalLight,
    createEngine,
    createEsmDirectionalShadowGenerator,
    createHemisphericLight,
    createSceneContext,
    createTransformNode,
    addAnimationGroups,
    addToScene,
    createAnimationManager,
    enableAnimationBlending,
    getBlendedJointWorldMatrix,
    getJointWorldMatrix,
    loadEnvironment,
    mat4Compose,
    mat4Decompose,
    mat4Multiply,
    onBeforeRender,
    playAnimation,
    registerSceneWithShadowSupport,
    setCameraLimits,
    setShadowTaskCasterMeshes,
    startEngine,
    stopAnimation,
    updateAnimationManager,
} from "babylon-lite";
import type { AnimationGroup, SceneNode } from "babylon-lite";
import { getAnimations, getClasses, getRaces, getOffhands, getWeapons, loadCharacter, loadWeapon, applyHead, attackClipFor, DEFAULT_GRIP_EULER } from "./dress-room/character.js";
import type { AnimationOption, CharacterClass, HeadOption, LoadedCharacter, LoadedWeapon, OffhandOption, Race, WeaponOption } from "./dress-room/character.js";
import { buildPanel } from "./dress-room/ui.js";
import type { DressRoomApi } from "./dress-room/ui.js";
import { createBackgrounds, getBackgrounds } from "./dress-room/background.js";
import type { BackgroundController, SceneLights } from "./dress-room/background.js";
import { demoAssetUrl } from "./demo-asset-url.js";
import { installFetchProgress } from "./loading-progress.js";

/** Asset folder served next to the demo bundle (downscaled CC0 KayKit assets). */
const ASSET_BASE = demoAssetUrl("./dress-room/", import.meta.url);

const DEFAULT_RACE = "human";
const DEFAULT_CLASS = "warrior";
const DEFAULT_SCENE = "dungeon";
const DEFAULT_ANIM = "idle";

/** KayKit clips played once to "spawn" a character when its class is selected,
 *  before it settles into the active animation. The set ships two — `Spawn_Air`
 *  (drops in from above) and `Spawn_Ground` (leaps up from the floor) — and one
 *  is chosen at random each time for variety. */
const SPAWN_CLIPS = ["Spawn_Air", "Spawn_Ground"] as const;

/** Default grip-orientation correction (Euler XYZ radians) for off-hand items in
 *  the left-hand socket. Stands the prop upright (local +Y → world up) with its
 *  face toward the front (local +Z → forward), which suits shields and the
 *  thematic props alike; individual items may override via {@link OffhandOption.grip}. */
const OFFHAND_GRIP_EULER: readonly [number, number, number] = [-Math.PI / 2, 0, Math.PI / 2];

/** Duration of a cross-fade between two animation clips, in milliseconds. Short
 *  enough to feel responsive, long enough to hide the pose mismatch (e.g. the
 *  spawn landing settling into idle). */
const FADE_MS = 220;

/** Smoothstep ease (3t²−2t³): zero velocity at both ends. Easing the cross-fade
 *  weight this way means the incoming clip's influence ramps in and out gently
 *  instead of snapping to a constant rate on the first and last frame — which
 *  otherwise reads as a small "catch" when one clip is still in motion as the
 *  next takes over (e.g. the spawn landing still rising as idle settles it down). */
const ease = (t: number): number => t * t * (3 - 2 * t);

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const progress = installFetchProgress(canvas, { estimatedBytes: 7_000_000 });
    try {
        const engine = await createEngine(canvas);
        const scene = createSceneContext(engine);

        // Camera framing the figure from the front. The KayKit figures are ~2.5
        // units tall, so the target sits at mid-body. The figure is static (no
        // auto-rotation); the user can still orbit and zoom by dragging.
        const camera = createArcRotateCamera(-Math.PI / 2, 1.15, 6.0, { x: 0, y: 1.25, z: 0 });
        camera.nearPlane = 0.1;
        camera.farPlane = 100;
        scene.camera = camera;
        attachControl(camera, canvas, scene);
        // Clamp zoom so the wheel/pinch can't dolly inside the figure or pull
        // back into the fog. Manual orbit stays free.
        setCameraLimits(camera, { lowerRadiusLimit: 3.0, upperRadiusLimit: 9.0 }, scene);

        // Image-based lighting for material reflections (textures only — the 3D
        // background scenes provide the visible surroundings, so skip the helper's
        // skybox + ground). ACES tone mapping set before registerScene.
        await loadEnvironment(scene, "https://assets.babylonjs.com/core/environments/environmentSpecular.env", {
            brdfUrl: demoAssetUrl("./brdf-lut.png", import.meta.url),
            skipGround: true,
            skipSkybox: true,
        });
        scene.imageProcessing.toneMappingEnabled = true;
        scene.imageProcessing.toneMappingType = "aces";
        scene.imageProcessing.exposure = 1.3;
        scene.imageProcessing.contrast = 1.05;

        // Shared lighting rig. Each background retunes intensity / tint for its
        // mood. The key light comes from ~45° above and in front of the figure
        // (the camera side, −Z), so the figure is front-lit and its cast shadow
        // falls behind it (+Z, toward the back wall).
        const hemi = createHemisphericLight([0, 1, 0], 1.0);
        addToScene(scene, hemi);
        const keyLight = createDirectionalLight([-0.3, -1.0, 0.7], 2.4);
        keyLight.position.set(3, 9, -6);
        addToScene(scene, keyLight);
        const fill = createDirectionalLight([0.8, -0.4, 0.6], 0.8);
        addToScene(scene, fill);
        const rim = createDirectionalLight([0.2, -0.3, -1.0], 0.6);
        addToScene(scene, rim);
        const lights: SceneLights = { hemi, key: keyLight, fill, rim };

        // Load every character class once (hidden); the active one is shown below.
        // The figures stand directly on the scene floor (no pedestal) and face the
        // camera. The glTF root carries a −1 X scale (RH→LH), so a 180° base yaw
        // turns the figure to face the camera (which sits on −Z); FLOOR_Y matches
        // the dungeon floor surface so the feet rest on it.
        const FLOOR_Y = -0.07;
        const BASE_FACING = Math.PI;
        const classDefs = getClasses();
        const place = (character: LoadedCharacter): void => {
            for (const root of character.roots) {
                root.position.set(0, FLOOR_Y, 0);
                root.rotation.set(0, BASE_FACING, 0);
            }
            character.setVisible(false);
        };
        // The base model per class, plus any whole-model head variants (the Rogue's
        // hooded/unhooded bodies) keyed by `classId` → `headId` → model.
        const characters = new Map<string, LoadedCharacter>();
        const altModels = new Map<string, Map<string, LoadedCharacter>>();
        for (const cls of classDefs) {
            const character = await loadCharacter(engine, scene, ASSET_BASE, cls);
            place(character);
            characters.set(cls.id, character);
            for (const head of cls.heads ?? []) {
                if (head.file && head.file !== cls.file) {
                    const alt = await loadCharacter(engine, scene, ASSET_BASE, { ...cls, file: head.file, heads: undefined });
                    place(alt);
                    let m = altModels.get(cls.id);
                    if (!m) {
                        m = new Map();
                        altModels.set(cls.id, m);
                    }
                    m.set(head.id, alt);
                }
            }
        }
        /** Resolve the model to show for a class + head: a whole-model head variant
         *  if one is registered, otherwise the class's base model. */
        const resolveModel = (classId: string, headId: string): LoadedCharacter =>
            altModels.get(classId)?.get(headId) ?? characters.get(classId)!;

        // One animation manager drives every model's clips. Enabling glTF blending
        // swaps in the weighted skeleton mixer, so two clips on the same figure can
        // play at once and be blended by weight — that's what lets one clip cross-fade
        // into the next instead of popping. Each model's clips start stopped, so only
        // the clips we explicitly play are ticked; the manager is advanced once per
        // frame below. (loadCharacter deliberately skips addToScene's per-container
        // ticker so clips aren't advanced twice.)
        const animMgr = createAnimationManager({ engine });
        enableAnimationBlending(animMgr);
        for (const model of characters.values()) {
            addAnimationGroups(animMgr, [...model.groups.values()]);
        }
        for (const variants of altModels.values()) {
            for (const model of variants.values()) {
                addAnimationGroups(animMgr, [...model.groups.values()]);
            }
        }

        // Held weapons. A single anchor node is driven each frame from the active
        // character's right-hand socket (handslot.r). Each weapon hangs under its
        // own grip node, which carries a per-weapon orientation correction (see
        // DEFAULT_GRIP_EULER / WeaponOption.grip — most weapons share a 180° spin
        // about their long axis; the bow overrides it). Because only one character
        // is visible at a time, one shared anchor + weapon set covers every class.
        const weaponAnchor = createTransformNode("weaponAnchor");
        addToScene(scene, weaponAnchor);
        const weaponDefs = getWeapons();
        const weapons = new Map<string, LoadedWeapon>();
        for (const w of weaponDefs) {
            if (w.file) {
                const [gx, gy, gz] = w.grip ?? DEFAULT_GRIP_EULER;
                const grip = createTransformNode("weaponGrip_" + w.id);
                grip.rotation.set(gx, gy, gz);
                grip.parent = weaponAnchor;
                addToScene(scene, grip);
                weapons.set(w.id, await loadWeapon(engine, scene, ASSET_BASE, w, grip as SceneNode));
            }
        }
        let activeWeapon = "none";
        // Re-run after a weapon or off-hand change (assigned once the animation +
        // panel wiring exists): re-resolves the equipment-driven Attack/Guard and
        // refreshes the panel. A no-op during the initial pre-UI setup.
        let afterEquipChange: () => void = () => {};
        let panelRefresh: () => void = () => {};
        const setWeapon = (id: string): void => {
            if (id === activeWeapon) {
                return;
            }
            weapons.get(activeWeapon)?.setVisible(false);
            weapons.get(id)?.setVisible(true);
            activeWeapon = id;
            afterEquipChange();
        };

        // Off-hand items (shields + thematic props), held in the LEFT hand socket
        // (handslot.l). Same pattern as weapons: one anchor driven each frame from
        // the socket, with a per-item grip node carrying the orientation correction.
        const offhandAnchor = createTransformNode("offhandAnchor");
        addToScene(scene, offhandAnchor);
        const offhandDefs = getOffhands();
        const offhands = new Map<string, LoadedWeapon>();
        for (const o of offhandDefs) {
            if (o.file) {
                const [gx, gy, gz] = o.grip ?? OFFHAND_GRIP_EULER;
                const grip = createTransformNode("offhandGrip_" + o.id);
                grip.rotation.set(gx, gy, gz);
                if (o.offset) {
                    grip.position.set(o.offset[0], o.offset[1], o.offset[2]);
                }
                grip.parent = offhandAnchor;
                addToScene(scene, grip);
                offhands.set(o.id, await loadWeapon(engine, scene, ASSET_BASE, o, grip as SceneNode));
            }
        }
        let activeOffhand = "none";
        const setOffhand = (id: string): void => {
            if (id === activeOffhand) {
                return;
            }
            offhands.get(activeOffhand)?.setVisible(false);
            offhands.get(id)?.setVisible(true);
            activeOffhand = id;
            afterEquipChange();
        };

        // Pre-build every switchable 3D background scene (hidden); one is
        // activated below. Building up front (before registerScene) keeps
        // switching to a pure visibility toggle.
        const backgrounds = await createBackgrounds(engine, scene, lights, ASSET_BASE, getBackgrounds());

        // Directional shadow from the key light. The caster list holds every
        // class's meshes; hidden classes are skipped automatically.
        keyLight.shadowGenerator = createEsmDirectionalShadowGenerator(engine, keyLight, {
            mapSize: 1024,
            depthScale: 50,
            bias: 0.00005,
            blurKernel: 32,
            blurScale: 2,
            darkness: 0,
            frustumEdgeFalloff: 0,
            orthoMinZ: camera.nearPlane,
            orthoMaxZ: camera.farPlane,
            forceRefreshEveryFrame: true,
        });
        const altList = [...altModels.values()].flatMap((m) => [...m.values()]);
        const allMeshes = [...characters.values(), ...altList].flatMap((c) => c.meshes);
        setShadowTaskCasterMeshes(keyLight.shadowGenerator, allMeshes);

        // Default class + background scene + animation.
        const anims = getAnimations();
        const animById = new Map(anims.map((a) => [a.id, a] as const));
        const classById = new Map(classDefs.map((c) => [c.id, c] as const));
        // Race grouping: the Race picker chooses a race and the Class picker then
        // offers only that race's classes. `classByRace` remembers the last class
        // chosen per race, so switching race and back restores your selection.
        const races = getRaces();
        const classesOfRace = (raceId: string): CharacterClass[] => races.find((r) => r.id === raceId)?.classes ?? [];
        const raceOfClass = new Map<string, string>();
        for (const r of races) {
            for (const c of r.classes) {
                raceOfClass.set(c.id, r.id);
            }
        }
        const classByRace = new Map<string, string>();
        for (const r of races) {
            if (r.classes[0]) {
                classByRace.set(r.id, r.classes[0].id);
            }
        }
        classByRace.set(DEFAULT_RACE, DEFAULT_CLASS);
        let activeRace = DEFAULT_RACE;
        let activeClass = DEFAULT_CLASS;
        let activeAnim = DEFAULT_ANIM;

        const hasShield = (): boolean => offhandDefs.find((o) => o.id === activeOffhand)?.kind === "shield";
        /** Animations currently offered: the Guard is hidden without a shield. */
        const availableAnims = (): AnimationOption[] => anims.filter((a) => !a.requiresShield || hasShield());
        /** Resolve a roster id to the clip to play on a figure: the weapon-driven
         *  Attack picks a swing/cast from the equipped weapon; a class may remap
         *  idle/walk to themed clips (the undead skeletal set); the rest are
         *  literal clip names. */
        const resolveClip = (character: LoadedCharacter, animId: string): string => {
            const opt = animById.get(animId);
            if (!opt) {
                return "";
            }
            if (opt.weaponDriven) {
                const w = weaponDefs.find((x) => x.id === activeWeapon);
                return attackClipFor(w?.hand, w?.kind);
            }
            return character.clipOverride?.[animId] ?? opt.clip;
        };

        // Cross-fading animation playback. Because the manager has glTF blending
        // enabled, two clips on the same figure can play at once; ramping their
        // weights over FADE_MS blends one into the next so transitions don't pop
        // (e.g. the spawn landing easing into idle). At most two clips are ever live
        // on the active figure: the steady `currentGroup` and, mid-fade, the
        // incoming one.
        let currentGroup: AnimationGroup | null = null;
        let fade: { from: AnimationGroup; to: AnimationGroup; t: number } | null = null;
        // A one-shot clip (spawn entrance, or a transient Attack / Dodge) that plays
        // once and then settles back into the held animation.
        let oneShotGroup: AnimationGroup | null = null;
        let oneShotChar: LoadedCharacter | null = null;

        /** Stop every clip on a figure (used when hiding it for a class / model swap). */
        const stopAll = (character: LoadedCharacter): void => {
            for (const g of character.groups.values()) {
                g.weight = 0;
                stopAnimation(g);
            }
        };

        /** Play `clip` on `character`, hard-cutting or cross-fading from whatever is
         *  already playing. Returns false (leaving the figure as-is) when the clip is
         *  missing. `immediate` forces a hard cut: used for snappy one-shots (Attack)
         *  and entrances (spawn) so the destination clip owns the pose from the first
         *  frame and a held prop tracks the hand without lag. Looping transitions
         *  cross-fade. */
        const transition = (character: LoadedCharacter, clip: string, opts: { loop: boolean; oneShot?: boolean; immediate?: boolean }): boolean => {
            const target = character.groups.get(clip);
            if (!target) {
                return false;
            }
            // Collapse any in-progress fade so at most two clips ever blend at once.
            if (fade) {
                fade.from.weight = 0;
                stopAnimation(fade.from);
                fade.to.weight = 1;
                fade = null;
            }
            const from = currentGroup;
            if (from === target && !opts.oneShot && target.isPlaying) {
                return true; // already holding this looping clip
            }
            if (opts.immediate || !from || !from.isPlaying || from === target) {
                // Hard cut: stop the others so the target owns the pose immediately.
                for (const g of character.groups.values()) {
                    if (g !== target && g.isPlaying) {
                        stopAnimation(g);
                    }
                }
                target.currentFrame = 0;
                target.loopAnimation = opts.loop;
                target.weight = 1;
                playAnimation(target);
            } else {
                // Cross-fade: start the target silent and ramp the weights each frame.
                target.currentFrame = 0;
                target.loopAnimation = opts.loop;
                target.weight = 0;
                playAnimation(target);
                fade = { from, to: target, t: 0 };
            }
            currentGroup = target;
            oneShotGroup = opts.oneShot ? target : null;
            oneShotChar = opts.oneShot ? character : null;
            return true;
        };

        /** Spawn entrance: a one-shot that hard-cuts in (there's no prior clip to
         *  blend from) and settles into the held animation once it finishes. */
        const spawn = (character: LoadedCharacter): void => {
            // A class may pin a themed spawn clip (the undead rise from the
            // floor as a skeleton); otherwise pick one of the shared spawns at random.
            const clip = character.clipOverride?.spawn ?? SPAWN_CLIPS[Math.floor(Math.random() * SPAWN_CLIPS.length)]!;
            if (!transition(character, clip, { loop: false, oneShot: true, immediate: true })) {
                transition(character, resolveClip(character, activeAnim), { loop: true, immediate: true });
            }
        };

        // Head/headgear variant per class (remembered as the user toggles, so it
        // persists when switching away and back). `setVisible(true)` re-shows every
        // mesh, so the head is re-applied after a class is shown.
        const headByClass = new Map<string, string>();
        for (const c of classDefs) {
            const def = c.head ?? c.heads?.[0]?.id;
            if (def) {
                headByClass.set(c.id, def);
            }
        }
        const headOf = (classId: string): string => headByClass.get(classId) ?? "";

        // The currently-visible model (a class's base model, or one of the Rogue's
        // hooded/unhooded variants). All per-frame and per-action code resolves the
        // active figure through this rather than the class id, so a whole-model head
        // swap re-points every consumer at once.
        let activeChar: LoadedCharacter = resolveModel(activeClass, headOf(activeClass));
        activeChar.setVisible(true);
        applyHead(activeChar, headOf(activeClass));
        spawn(activeChar);
        setWeapon(classById.get(activeClass)?.weapon ?? "none");
        setOffhand(classById.get(activeClass)?.offhand ?? "none");
        backgrounds.activate(backgrounds.defs.some((d) => d.id === DEFAULT_SCENE) ? DEFAULT_SCENE : backgrounds.defs[0]!.id);

        const setClass = (id: string): void => {
            if (id === activeClass || !characters.has(id)) {
                return;
            }
            stopAll(activeChar); // stop the outgoing figure's clips
            activeChar.setVisible(false);
            // Reset transition state: the incoming figure has its own clips.
            fade = null;
            oneShotGroup = null;
            oneShotChar = null;
            currentGroup = null;
            activeClass = id;
            // Keep the race in sync and remember this class for its race, so a class
            // picked directly (or via Randomize, which may cross races) updates the
            // Race picker and is restored when you return to that race.
            activeRace = raceOfClass.get(id) ?? activeRace;
            classByRace.set(activeRace, id);
            activeChar = resolveModel(id, headOf(id));
            activeChar.setVisible(true);
            applyHead(activeChar, headOf(id));
            spawn(activeChar);
            setWeapon(classById.get(id)?.weapon ?? "none");
            setOffhand(classById.get(id)?.offhand ?? "none");
        };

        // Switch race: show the class last chosen for that race (or its first), which
        // routes through setClass to swap the model, gear, and animation.
        const setRace = (id: string): void => {
            if (id === activeRace || classesOfRace(id).length === 0) {
                return;
            }
            const target = classByRace.get(id) ?? classesOfRace(id)[0]!.id;
            setClass(target);
        };

        const setHead = (id: string): void => {
            headByClass.set(activeClass, id);
            const next = resolveModel(activeClass, id);
            if (next === activeChar) {
                // Same model — a mesh-toggle head variant; just re-show the meshes.
                applyHead(activeChar, id);
                return;
            }
            // Whole-model swap (Rogue hooded ⇄ unhooded): hand the active animation
            // over to the incoming model without replaying the spawn. The two models
            // are separate skeletons, so there's nothing to blend — hard-cut.
            stopAll(activeChar);
            activeChar.setVisible(false);
            fade = null;
            oneShotGroup = null;
            oneShotChar = null;
            currentGroup = null;
            activeChar = next;
            activeChar.setVisible(true);
            applyHead(activeChar, id);
            transition(activeChar, resolveClip(activeChar, activeAnim), { loop: true, immediate: true });
        };

        // Drive the weapon anchor from the active character's right-hand socket
        // every frame, so a held prop follows the animated bone.
        //
        // Mirror bookkeeping: the glTF loader wraps every asset (characters AND
        // weapons) in a synthetic `__root__` whose scale `diag(-1, 1, 1)` performs
        // the right-handed → left-handed conversion. The skeleton controller bakes
        // that same mirror into the joint world matrix it reports. So
        // `char.roots[0].worldMatrix` and `jointMat` each already carry one mirror;
        // multiplying them directly applies it twice, which reflects the socket's
        // rotation and makes the prop counter-rotate against the hand as it
        // animates. Re-inserting one `MIRROR_X` between them cancels the double
        // application and lands on the true socket frame. A second, trailing
        // `MIRROR_X` pre-cancels the weapon prop's OWN `__root__` mirror, so the
        // prop sits exactly in the hand. The resulting frame is a proper rotation
        // (determinant +1), so position + rotation fully describe it and the prop
        // is never culled inside-out.
        const MIRROR_X = mat4Compose(0, 0, 0, 0, 0, 0, 1, -1, 1, 1);
        const wPos: [number, number, number] = [0, 0, 0];
        const wQuat: [number, number, number, number] = [0, 0, 0, 1];
        const wScale: [number, number, number] = [1, 1, 1];
        // Drive a placement anchor from the active character's named hand socket.
        // Shared by the right-hand weapon (handslot.r) and the left-hand off-hand
        // item (handslot.l).
        const driveAnchor = (anchor: SceneNode, socket: string): void => {
            const char = activeChar;
            if (!char) {
                return;
            }
            // Pick the dominant (highest-weight) playing clip. During a steady
            // cross-fade the blended socket pose below is the same whichever clip we
            // pass, but on the single frame a settle is set up the incoming clip has
            // just been played at weight 0 and not yet ticked, and the mixer has not
            // blended the figure this frame — so the fallback would read that clip's
            // stale (or zero) controller pose and pop the prop off the hand for one
            // frame. The weight-1 clip is the one actually rendered this frame, and
            // its controller pose is fresh, so resolve the socket through it.
            let playing: AnimationGroup | undefined;
            let bestWeight = -1;
            for (const g of char.groups.values()) {
                if (g.isPlaying && g.weight > bestWeight) {
                    playing = g;
                    bestWeight = g.weight;
                }
            }
            // While the figure is cross-fading, no single controller holds its pose,
            // so read the mixer's blended socket matrix; otherwise read the steady
            // controller. This keeps the held prop on the hand through a transition.
            const jointMat = playing ? (getBlendedJointWorldMatrix(playing, socket) ?? getJointWorldMatrix(playing, socket)) : null;
            if (!jointMat) {
                return;
            }
            const rootWorld = char.roots[0]!.worldMatrix;
            const world = mat4Multiply(mat4Multiply(mat4Multiply(rootWorld, MIRROR_X), jointMat), MIRROR_X);
            mat4Decompose(world, wPos, wQuat, wScale);
            anchor.position.set(wPos[0], wPos[1], wPos[2]);
            anchor.rotationQuaternion!.set(wQuat[0], wQuat[1], wQuat[2], wQuat[3]);
        };
        // Per-frame animation update, in strict order: advance any cross-fade
        // weights, tick the manager (which blends the live clips on each figure and
        // uploads one skeleton per figure), settle a one-shot back into the held
        // animation as it nears its end, then drive the held props from the hand
        // sockets. The anchor driver reads the mixer's blended socket pose during a
        // fade, so props keep tracking the hand through the transition.
        onBeforeRender(scene, (deltaMs) => {
            if (fade) {
                fade.t += deltaMs;
                const k = Math.min(1, fade.t / FADE_MS);
                const w = ease(k);
                fade.from.weight = 1 - w;
                fade.to.weight = w;
                if (k >= 1) {
                    fade.from.weight = 0;
                    stopAnimation(fade.from);
                    fade.to.weight = 1;
                    fade = null;
                }
            }
            updateAnimationManager(animMgr, deltaMs);
            // Begin settling a one-shot (spawn entrance, Attack, Dodge) back into the
            // held animation slightly BEFORE it reaches its final frame, so the
            // action's tail cross-fades into the held clip while it is still in
            // motion. Waiting for the exact end would render one frame of the
            // fully-finished action before the blend starts — which reads as the
            // action "running one extra frame" — and leaves the fade no time overlap.
            // The lead is capped at half the clip so a short action still plays most
            // of the way through.
            if (oneShotGroup) {
                const lead = Math.min(FADE_MS / 1000, oneShotGroup.duration * 0.5);
                if (oneShotGroup.currentFrame >= oneShotGroup.duration - lead) {
                    const ch = oneShotChar;
                    oneShotGroup = null;
                    oneShotChar = null;
                    if (ch) {
                        transition(ch, resolveClip(ch, activeAnim), { loop: true });
                    }
                }
            }
            if (activeWeapon !== "none") {
                driveAnchor(weaponAnchor as SceneNode, "handslot.r");
            }
            if (activeOffhand !== "none") {
                driveAnchor(offhandAnchor as SceneNode, "handslot.l");
            }
        });

        const setAnimation = (animId: string): void => {
            const opt = animById.get(animId);
            if (!opt || (opt.requiresShield && !hasShield())) {
                return;
            }
            if (opt.oneShot) {
                // Transient action (Attack / Dodge): hard-cut in so it reads snappy
                // and a held weapon tracks the swing from the first frame, then settle
                // back into the held animation — `activeAnim` is left unchanged.
                if (!transition(activeChar, resolveClip(activeChar, animId), { loop: false, oneShot: true, immediate: true })) {
                    transition(activeChar, resolveClip(activeChar, activeAnim), { loop: true });
                }
                return;
            }
            activeAnim = animId;
            transition(activeChar, resolveClip(activeChar, animId), { loop: true });
        };

        // Now that the animation machinery exists, react to equipment changes:
        // drop the Guard if its shield was removed, then refresh the panel so the
        // Attack/Guard availability reflects the new loadout.
        afterEquipChange = (): void => {
            if (activeAnim === "guard" && !hasShield()) {
                activeAnim = DEFAULT_ANIM;
                transition(activeChar, resolveClip(activeChar, activeAnim), { loop: true });
            }
            panelRefresh();
        };

        await registerSceneWithShadowSupport(engine, scene);
        progress.done();
        await startEngine(engine);

        panelRefresh = wireUi({
            races,
            getRaceId: () => activeRace,
            setRace,
            getRaceClasses: () => classesOfRace(activeRace),
            getClassId: () => activeClass,
            setClass,
            getAvailableAnims: availableAnims,
            getAnimId: () => activeAnim,
            setAnimation,
            weaponDefs,
            getWeaponId: () => activeWeapon,
            setWeapon,
            offhandDefs,
            getOffhandId: () => activeOffhand,
            setOffhand,
            getHeads: () => classById.get(activeClass)?.heads ?? [],
            getHeadId: () => headOf(activeClass),
            setHead,
            backgrounds,
        });

        canvas.dataset.drawCalls = String(engine.drawCallCount);
        canvas.dataset.initMs = String(performance.now() - __initStart);
        canvas.dataset.ready = "true";
    } catch (err) {
        progress.done();
        canvas.dataset.error = String(err);
        console.error(err);
    }
}

// ─── UI wiring ────────────────────────────────────────────────────────

interface WireUiParams {
    races: Race[];
    getRaceId: () => string;
    setRace: (id: string) => void;
    getRaceClasses: () => CharacterClass[];
    getClassId: () => string;
    setClass: (id: string) => void;
    getAvailableAnims: () => AnimationOption[];
    getAnimId: () => string;
    setAnimation: (id: string) => void;
    weaponDefs: WeaponOption[];
    getWeaponId: () => string;
    setWeapon: (id: string) => void;
    offhandDefs: OffhandOption[];
    getOffhandId: () => string;
    setOffhand: (id: string) => void;
    getHeads: () => HeadOption[];
    getHeadId: () => string;
    setHead: (id: string) => void;
    backgrounds: BackgroundController;
}

function wireUi(p: WireUiParams): () => void {
    const { races, getRaceId, setRace, getRaceClasses, getClassId, setClass, getAvailableAnims, getAnimId, setAnimation, weaponDefs, getWeaponId, setWeapon, offhandDefs, getOffhandId, setOffhand, getHeads, getHeadId, setHead, backgrounds } = p;
    const api: DressRoomApi = {
        races: races.map((r) => ({ id: r.id, label: r.label })),
        classes: getRaceClasses().map((c) => ({ id: c.id, label: c.label })),
        scenes: backgrounds.defs.map((d) => ({ id: d.id, label: d.label })),
        weapons: weaponDefs.map((w) => ({ id: w.id, label: w.label })),
        offhands: offhandDefs.map((o) => ({ id: o.id, label: o.label })),
        slots: [],
        presets: [],
        tintable: false,
        getRace: () => getRaceId(),
        setRace: (id) => setRace(id),
        getClasses: () => getRaceClasses().map((c) => ({ id: c.id, label: c.label })),
        getClass: () => getClassId(),
        setClass: (id) => setClass(id),
        getScene: () => backgrounds.current(),
        setScene: (id) => backgrounds.activate(id),
        getWeapon: () => getWeaponId(),
        setWeapon: (id) => setWeapon(id),
        getOffhand: () => getOffhandId(),
        setOffhand: (id) => setOffhand(id),
        getHeads: () => getHeads().map((h) => ({ id: h.id, label: h.label })),
        getHead: () => getHeadId(),
        setHead: (id) => setHead(id),
        getOption: () => "none",
        setOption: () => {},
        cycleOption: () => {},
        getAnimations: () => getAvailableAnims().map((a) => ({ id: a.id, label: a.label })),
        getAnimation: () => getAnimId(),
        setAnimation: (id) => setAnimation(id),
        getTint: () => null,
        setTint: () => {},
        resetTint: () => {},
        randomize: () => {
            // Pick a random race, then a random class within it; setClass keeps the
            // Race picker in sync.
            const race = races[Math.floor(Math.random() * races.length)]!;
            const pick = race.classes[Math.floor(Math.random() * race.classes.length)]!;
            setClass(pick.id);
            const w = weaponDefs[Math.floor(Math.random() * weaponDefs.length)]!;
            setWeapon(w.id);
            const o = offhandDefs[Math.floor(Math.random() * offhandDefs.length)]!;
            setOffhand(o.id);
        },
        applyPreset: () => {},
    };
    return buildPanel(api).refresh;
}

void main();
