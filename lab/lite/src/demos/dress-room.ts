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
    addToScene,
    loadEnvironment,
    playAnimation,
    registerSceneWithShadowSupport,
    setCameraLimits,
    setShadowTaskCasterMeshes,
    startEngine,
    stopAnimation,
} from "babylon-lite";
import { getAnimations, getClasses, loadCharacter } from "./dress-room/character.js";
import type { AnimationOption, CharacterClass, LoadedCharacter } from "./dress-room/character.js";
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

/** Play one animation (by roster id) on a character, stopping all its others.
 *  Falls back gracefully if the clip is missing on this character. */
function applyAnimation(character: LoadedCharacter, animId: string, anims: readonly AnimationOption[]): void {
    const clip = anims.find((a) => a.id === animId)?.clip;
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
        let activeClass = DEFAULT_CLASS;
        let activeAnim = DEFAULT_ANIM;
        const startChar = characters.get(activeClass);
        if (startChar) {
            startChar.setVisible(true);
            applyAnimation(startChar, activeAnim, anims);
        }
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
                applyAnimation(next, activeAnim, anims);
            }
            activeClass = id;
        };

        const setAnimation = (animId: string): void => {
            activeAnim = animId;
            const character = characters.get(activeClass);
            if (character) {
                applyAnimation(character, animId, anims);
            }
        };

        await registerSceneWithShadowSupport(engine, scene);
        progress.done();
        await startEngine(engine);

        wireUi(classDefs, () => activeClass, setClass, anims, () => activeAnim, setAnimation, backgrounds);

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

function wireUi(
    classDefs: CharacterClass[],
    getClassId: () => string,
    setClass: (id: string) => void,
    anims: AnimationOption[],
    getAnimId: () => string,
    setAnimation: (id: string) => void,
    backgrounds: BackgroundController
): void {
    const animById = new Map(anims.map((a) => [a.id, a.label] as const));
    const api: DressRoomApi = {
        classes: classDefs.map((c) => ({ id: c.id, label: c.label })),
        scenes: backgrounds.defs.map((d) => ({ id: d.id, label: d.label })),
        slots: [],
        animations: anims.map((a) => a.label),
        presets: [],
        tintable: false,
        getClass: () => getClassId(),
        setClass: (id) => setClass(id),
        getScene: () => backgrounds.current(),
        setScene: (id) => backgrounds.activate(id),
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
        },
        applyPreset: () => {},
    };
    buildPanel(api);
}

void main();
