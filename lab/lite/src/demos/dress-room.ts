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
    addToScene,
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
} from "babylon-lite";
import type { AnimationGroup, SceneNode } from "babylon-lite";
import { getAnimations, getClasses, getOffhands, getWeapons, loadCharacter, loadWeapon, DEFAULT_GRIP_EULER } from "./dress-room/character.js";
import type { AnimationOption, CharacterClass, LoadedCharacter, LoadedWeapon, OffhandOption, WeaponOption } from "./dress-room/character.js";
import { buildPanel } from "./dress-room/ui.js";
import type { DressRoomApi } from "./dress-room/ui.js";
import { createBackgrounds, getBackgrounds } from "./dress-room/background.js";
import type { BackgroundController, SceneLights } from "./dress-room/background.js";
import { demoAssetUrl } from "./demo-asset-url.js";
import { installFetchProgress } from "./loading-progress.js";

/** Asset folder served next to the demo bundle (downscaled CC0 KayKit assets). */
const ASSET_BASE = demoAssetUrl("./dress-room/", import.meta.url);

const DEFAULT_CLASS = "knight";
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

/** Play one animation (by roster id) on a character, stopping all its others.
 *  Falls back gracefully if the clip is missing on this character. A class may
 *  remap a roster id to a themed clip via its `clipOverride` (e.g. the
 *  necromancer's skeletal idle/walk). */
function applyAnimation(character: LoadedCharacter, animId: string, anims: readonly AnimationOption[]): void {
    const clip = character.clipOverride?.[animId] ?? anims.find((a) => a.id === animId)?.clip;
    for (const [name, group] of character.groups) {
        if (name === clip) {
            playAnimation(group);
        } else if (group.isPlaying) {
            stopAnimation(group);
        }
    }
}

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
        const characters = new Map<string, LoadedCharacter>();
        for (const cls of classDefs) {
            const character = await loadCharacter(engine, scene, ASSET_BASE, cls);
            for (const root of character.roots) {
                root.position.set(0, FLOOR_Y, 0);
                root.rotation.set(0, BASE_FACING, 0);
            }
            character.setVisible(false);
            characters.set(cls.id, character);
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
        const setWeapon = (id: string): void => {
            if (id === activeWeapon) {
                return;
            }
            weapons.get(activeWeapon)?.setVisible(false);
            weapons.get(id)?.setVisible(true);
            activeWeapon = id;
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
        const allMeshes = [...characters.values()].flatMap((c) => c.meshes);
        setShadowTaskCasterMeshes(keyLight.shadowGenerator, allMeshes);

        // Default class + background scene + animation.
        const anims = getAnimations();
        const classById = new Map(classDefs.map((c) => [c.id, c] as const));
        let activeClass = DEFAULT_CLASS;
        let activeAnim = DEFAULT_ANIM;

        // Spawn handling. Selecting a class plays a randomly chosen one-shot spawn
        // clip, then settles the figure into the active animation when it finishes.
        //
        // These clips must NOT loop and must restart from frame 0 each time. The
        // group-level `loopAnimation`/`currentFrame` fields don't help here: the
        // container animation ticker advances each clip's controller directly, so
        // those group fields are never synced to (or from) the controller. We drive
        // the controller instead — reset its time, disable looping (it then clamps
        // at the final frame), and ensure it is playing — and read its clamped time
        // to know when the spawn has finished.
        let spawnGroup: AnimationGroup | null = null;
        let spawnChar: LoadedCharacter | null = null;
        const playSpawn = (character: LoadedCharacter): void => {
            // A class may pin a themed spawn clip (the necromancer rises from the
            // floor as a skeleton); otherwise pick one of the shared spawns at random.
            const clip = character.clipOverride?.spawn ?? SPAWN_CLIPS[Math.floor(Math.random() * SPAWN_CLIPS.length)]!;
            const spawn = character.groups.get(clip);
            const ctrl = spawn?._ctrl;
            if (!spawn || !ctrl) {
                applyAnimation(character, activeAnim, anims);
                return;
            }
            for (const g of character.groups.values()) {
                if (g !== spawn && g.isPlaying) {
                    stopAnimation(g);
                }
            }
            playAnimation(spawn);
            ctrl.time = 0;
            ctrl.loop = false;
            ctrl.playing = true;
            spawnGroup = spawn;
            spawnChar = character;
        };

        const startChar = characters.get(activeClass);
        if (startChar) {
            startChar.setVisible(true);
            playSpawn(startChar);
        }
        setWeapon(classById.get(activeClass)?.weapon ?? "none");
        setOffhand(classById.get(activeClass)?.offhand ?? "none");
        backgrounds.activate(backgrounds.defs.some((d) => d.id === DEFAULT_SCENE) ? DEFAULT_SCENE : backgrounds.defs[0]!.id);

        const setClass = (id: string): void => {
            if (id === activeClass || !characters.has(id)) {
                return;
            }
            const prev = characters.get(activeClass);
            if (prev) {
                applyAnimation(prev, "", anims); // stop the outgoing character's clips
                prev.setVisible(false);
            }
            const next = characters.get(id);
            if (next) {
                next.setVisible(true);
                playSpawn(next);
            }
            activeClass = id;
            setWeapon(classById.get(id)?.weapon ?? "none");
            setOffhand(classById.get(id)?.offhand ?? "none");
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
            const char = characters.get(activeClass);
            if (!char) {
                return;
            }
            let playing: AnimationGroup | undefined;
            for (const g of char.groups.values()) {
                if (g.isPlaying) {
                    playing = g;
                    break;
                }
            }
            const jointMat = playing ? getJointWorldMatrix(playing, socket) : null;
            if (!jointMat) {
                return;
            }
            const rootWorld = char.roots[0]!.worldMatrix;
            const world = mat4Multiply(mat4Multiply(mat4Multiply(rootWorld, MIRROR_X), jointMat), MIRROR_X);
            mat4Decompose(world, wPos, wQuat, wScale);
            anchor.position.set(wPos[0], wPos[1], wPos[2]);
            anchor.rotationQuaternion!.set(wQuat[0], wQuat[1], wQuat[2], wQuat[3]);
        };
        onBeforeRender(scene, () => {
            if (activeWeapon !== "none") {
                driveAnchor(weaponAnchor as SceneNode, "handslot.r");
            }
            if (activeOffhand !== "none") {
                driveAnchor(offhandAnchor as SceneNode, "handslot.l");
            }
        });

        // Settle a freshly spawned figure into the active animation once its
        // one-shot spawn clip reaches the end. Looping is disabled on the spawn
        // controller, so its play head clamps at the clip duration; this runs
        // before the animation ticker each frame, so the active animation takes
        // over without the spawn's final frame looping back to the start.
        onBeforeRender(scene, () => {
            const ctrl = spawnGroup?._ctrl;
            if (spawnGroup && ctrl && ctrl.time >= spawnGroup.duration - 1 / 120) {
                const ch = spawnChar;
                spawnGroup = null;
                spawnChar = null;
                if (ch) {
                    applyAnimation(ch, activeAnim, anims);
                }
            }
        });

        const setAnimation = (animId: string): void => {
            activeAnim = animId;
            // A manual animation pick cancels any in-progress spawn settle-in.
            spawnGroup = null;
            spawnChar = null;
            const character = characters.get(activeClass);
            if (character) {
                applyAnimation(character, animId, anims);
            }
        };

        await registerSceneWithShadowSupport(engine, scene);
        progress.done();
        await startEngine(engine);

        wireUi({
            classDefs,
            getClassId: () => activeClass,
            setClass,
            anims,
            getAnimId: () => activeAnim,
            setAnimation,
            weaponDefs,
            getWeaponId: () => activeWeapon,
            setWeapon,
            offhandDefs,
            getOffhandId: () => activeOffhand,
            setOffhand,
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
    classDefs: CharacterClass[];
    getClassId: () => string;
    setClass: (id: string) => void;
    anims: AnimationOption[];
    getAnimId: () => string;
    setAnimation: (id: string) => void;
    weaponDefs: WeaponOption[];
    getWeaponId: () => string;
    setWeapon: (id: string) => void;
    offhandDefs: OffhandOption[];
    getOffhandId: () => string;
    setOffhand: (id: string) => void;
    backgrounds: BackgroundController;
}

function wireUi(p: WireUiParams): void {
    const { classDefs, getClassId, setClass, anims, getAnimId, setAnimation, weaponDefs, getWeaponId, setWeapon, offhandDefs, getOffhandId, setOffhand, backgrounds } = p;
    const animById = new Map(anims.map((a) => [a.id, a.label] as const));
    const api: DressRoomApi = {
        classes: classDefs.map((c) => ({ id: c.id, label: c.label })),
        scenes: backgrounds.defs.map((d) => ({ id: d.id, label: d.label })),
        weapons: weaponDefs.map((w) => ({ id: w.id, label: w.label })),
        offhands: offhandDefs.map((o) => ({ id: o.id, label: o.label })),
        slots: [],
        animations: anims.map((a) => a.label),
        presets: [],
        tintable: false,
        getClass: () => getClassId(),
        setClass: (id) => setClass(id),
        getScene: () => backgrounds.current(),
        setScene: (id) => backgrounds.activate(id),
        getWeapon: () => getWeaponId(),
        setWeapon: (id) => setWeapon(id),
        getOffhand: () => getOffhandId(),
        setOffhand: (id) => setOffhand(id),
        getOption: () => "none",
        setOption: () => {},
        cycleOption: () => {},
        getAnimation: () => animById.get(getAnimId()) ?? "",
        setAnimation: (label) => {
            const opt = anims.find((a) => a.label === label);
            if (opt) {
                setAnimation(opt.id);
            }
        },
        getTint: () => null,
        setTint: () => {},
        resetTint: () => {},
        randomize: () => {
            const pick = classDefs[Math.floor(Math.random() * classDefs.length)]!;
            setClass(pick.id);
            const w = weaponDefs[Math.floor(Math.random() * weaponDefs.length)]!;
            setWeapon(w.id);
            const o = offhandDefs[Math.floor(Math.random() * offhandDefs.length)]!;
            setOffhand(o.id);
        },
        applyPreset: () => {},
    };
    buildPanel(api);
}

void main();
