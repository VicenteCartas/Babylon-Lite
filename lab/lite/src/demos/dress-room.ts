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
    createCylinder,
    createDirectionalLight,
    createEngine,
    createEsmDirectionalShadowGenerator,
    createHemisphericLight,
    createPbrMaterial,
    createSceneContext,
    createSolidTexture2D,
    addToScene,
    loadEnvironment,
    onBeforeRender,
    registerSceneWithShadowSupport,
    setShadowTaskCasterMeshes,
    startEngine,
} from "babylon-lite";
import { getClasses, loadCharacter } from "./dress-room/character.js";
import type { CharacterClass, LoadedCharacter } from "./dress-room/character.js";
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

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const progress = installFetchProgress(canvas, { estimatedBytes: 7_000_000 });
    try {
        const engine = await createEngine(canvas);
        const scene = createSceneContext(engine);

        // Turntable camera. Zoom is clamped (see the render loop) so the wheel
        // can't dolly inside the figure or pull back into empty space. The KayKit
        // figures are ~2.5 units tall, so the target sits at mid-body and the
        // start angle faces the front.
        const MIN_RADIUS = 3.0;
        const MAX_RADIUS = 9.0;
        const camera = createArcRotateCamera(-Math.PI / 2, 1.15, 6.0, { x: 0, y: 1.25, z: 0 });
        camera.nearPlane = 0.1;
        camera.farPlane = 100;
        scene.camera = camera;
        attachControl(camera, canvas, scene);

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
        // mood; the key light always casts the figure's shadow.
        const hemi = createHemisphericLight([0, 1, 0], 1.0);
        addToScene(scene, hemi);
        const keyLight = createDirectionalLight([-0.5, -1.0, -0.6], 2.4);
        keyLight.position.set(4, 8, 4);
        addToScene(scene, keyLight);
        const fill = createDirectionalLight([0.8, -0.4, 0.6], 0.8);
        addToScene(scene, fill);
        const rim = createDirectionalLight([0.2, -0.3, -1.0], 0.6);
        addToScene(scene, rim);
        const lights: SceneLights = { hemi, key: keyLight, fill, rim };

        // Neutral stone pedestal the figure stands on (persists across scenes,
        // grounds the figure and receives its cast shadow).
        const pedestal = createCylinder(engine, { height: 0.12, diameter: 2.4, tessellation: 48 });
        pedestal.material = createPbrMaterial({
            baseColorTexture: createSolidTexture2D(engine, 0.16, 0.15, 0.17, 1),
            ormTexture: createSolidTexture2D(engine, 1.0, 0.6, 0.0, 1),
        });
        pedestal.position.set(0, -0.06, 0);
        pedestal.receiveShadows = true;
        addToScene(scene, pedestal);

        // Load every character class once (hidden); the active one is shown below.
        const classDefs = getClasses();
        const characters = new Map<string, LoadedCharacter>();
        for (const cls of classDefs) {
            const character = await loadCharacter(engine, scene, ASSET_BASE, cls);
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

        // Default class + background scene.
        let activeClass = DEFAULT_CLASS;
        characters.get(activeClass)?.setVisible(true);
        backgrounds.activate(backgrounds.defs.some((d) => d.id === DEFAULT_SCENE) ? DEFAULT_SCENE : backgrounds.defs[0]!.id);

        const setClass = (id: string): void => {
            if (id === activeClass || !characters.has(id)) {
                return;
            }
            characters.get(activeClass)?.setVisible(false);
            characters.get(id)?.setVisible(true);
            activeClass = id;
        };

        // Turntable: the camera stays put while the figure slowly rotates on the
        // pedestal (so the 3D backdrop holds still). A base offset of -90° turns
        // the KayKit figure — which faces +X — toward the front camera; rotation
        // pauses on first interaction and resumes after the user stops dragging.
        const BASE_FACING = -Math.PI / 2;
        let spinAngle = 0;
        let spinning = true;
        let lastInteractionMs = -Infinity;
        const markInteraction = (): void => {
            spinning = false;
            lastInteractionMs = performance.now();
        };
        canvas.addEventListener("pointerdown", markInteraction);
        canvas.addEventListener("wheel", markInteraction, { passive: true });
        const IDLE_RESUME_MS = 4000;
        onBeforeRender(scene, (deltaMs) => {
            if (!spinning && performance.now() - lastInteractionMs > IDLE_RESUME_MS) {
                spinning = true;
            }
            if (spinning) {
                spinAngle += deltaMs * 0.0004;
            }
            const yaw = BASE_FACING + spinAngle;
            for (const root of characters.get(activeClass)?.roots ?? []) {
                root.rotation.set(0, yaw, 0);
            }
            if (camera.radius < MIN_RADIUS) {
                camera.radius = MIN_RADIUS;
                camera.inertialRadiusOffset = 0;
            } else if (camera.radius > MAX_RADIUS) {
                camera.radius = MAX_RADIUS;
                camera.inertialRadiusOffset = 0;
            }
        });

        await registerSceneWithShadowSupport(engine, scene);
        progress.done();
        await startEngine(engine);

        wireUi(classDefs, () => activeClass, setClass, backgrounds);

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

function wireUi(classDefs: CharacterClass[], getClassId: () => string, setClass: (id: string) => void, backgrounds: BackgroundController): void {
    const api: DressRoomApi = {
        classes: classDefs.map((c) => ({ id: c.id, label: c.label })),
        scenes: backgrounds.defs.map((d) => ({ id: d.id, label: d.label })),
        slots: [],
        animations: [],
        presets: [],
        tintable: false,
        getClass: () => getClassId(),
        setClass: (id) => setClass(id),
        getScene: () => backgrounds.current(),
        setScene: (id) => backgrounds.activate(id),
        getOption: () => "none",
        setOption: () => {},
        cycleOption: () => {},
        getAnimation: () => "",
        setAnimation: () => {},
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
