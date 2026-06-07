/** Dress-Room Demo — a dressing-room showcase using real CC0 modular character art.
 *
 *  A rigged humanoid stands on a turntable pedestal under studio lighting. The
 *  control panel lets you swap the outfit piece in each body region (head,
 *  shoulders, body, arms, legs, feet) between Peasant and Ranger variants — or
 *  none, baring the underlying body — and apply a themed preset. Because all of
 *  the parts share one rig, bind pose and origin, dressing the figure is simply
 *  toggling outfit meshes on over the always-visible base body.
 *
 *  Art credit: "Universal Base Characters" and "Modular Character Outfits –
 *  Fantasy" by Quaternius (https://quaternius.com), released under CC0 1.0
 *  (public domain). Textures are downscaled copies committed under
 *  lab/public/dress-room/. The figure is shown in its rest (bind) pose. */

import {
    addToScene,
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
    loadEnvironment,
    loadGltf,
    onBeforeRender,
    registerSceneWithShadowSupport,
    setShadowTaskCasterMeshes,
    startEngine,
} from "babylon-lite";
import type { EngineContext, SceneContext, SceneNode } from "babylon-lite";
import { BASE_BODY_FILE, collectMeshes, getBodies, getCatalog, loadPart } from "./dress-room/outfit.js";
import type { OutfitPart, SlotId } from "./dress-room/outfit.js";
import { buildPanel } from "./dress-room/ui.js";
import type { DressRoomApi } from "./dress-room/ui.js";
import { createBackgrounds, getBackgrounds } from "./dress-room/background.js";
import type { BackgroundController, SceneLights } from "./dress-room/background.js";
import { demoAssetUrl } from "./demo-asset-url.js";
import { installFetchProgress } from "./loading-progress.js";

/** Asset folder served next to the demo bundle (downscaled CC0 glTF parts). */
const ASSET_BASE = demoAssetUrl("./dress-room/", import.meta.url);

const PRESETS: Record<string, Record<SlotId, string>> = {
    Ranger: { head: "ranger", shoulders: "ranger", body: "ranger", arms: "ranger", legs: "ranger", feet: "ranger" },
    Peasant: { head: "none", shoulders: "none", body: "peasant", arms: "peasant", legs: "peasant", feet: "peasant" },
    Bare: { head: "none", shoulders: "none", body: "none", arms: "none", legs: "none", feet: "none" },
};

async function main(): Promise<void> {
    const __initStart = performance.now();
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const progress = installFetchProgress(canvas, { estimatedBytes: 9_000_000 });
    try {
        const engine = await createEngine(canvas);
        const scene = createSceneContext(engine);

        // Turntable camera. Zoom is clamped (see the render loop) so the wheel
        // can't dolly inside the figure or pull back into empty space.
        const MIN_RADIUS = 2.2;
        const MAX_RADIUS = 7.0;
        const camera = createArcRotateCamera(Math.PI / 2, 1.2, 4.2, { x: 0, y: 1.0, z: 0 });
        camera.nearPlane = 0.1;
        camera.farPlane = 100;
        scene.camera = camera;
        attachControl(camera, canvas, scene);

        // Image-based lighting for material reflections (textures only — the 3D
        // background scenes provide the visible surroundings, so skip the helper's
        // skybox + ground). Set ACES tone mapping before registerScene for richer
        // fabrics.
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

        // Base humanoid body — always visible; the outfit parts layer over it.
        const baseGltf = await loadGltf(engine, ASSET_BASE + BASE_BODY_FILE);
        for (const entity of baseGltf.entities) {
            addToScene(scene, entity);
        }
        const baseMeshes = collectMeshes(baseGltf.entities as SceneNode[]);

        // Load every outfit part once (hidden), keyed by slot + option id.
        const wardrobe = await buildWardrobe(engine, scene);

        // Pre-build every switchable 3D background scene (hidden); one is
        // activated below. Building up front (before registerScene) keeps
        // switching to a pure visibility toggle.
        const backgrounds = await createBackgrounds(engine, scene, lights, ASSET_BASE, getBackgrounds());

        // Directional shadow from the key light. The caster list holds the base
        // body plus every outfit part; hidden parts are skipped automatically.
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
        const partMeshes = wardrobe.slots.flatMap((s) => [...s.parts.values()].flatMap((p) => p.meshes));
        setShadowTaskCasterMeshes(keyLight.shadowGenerator, [...baseMeshes, ...partMeshes]);

        // Default loadout + background scene.
        applyLoadout(wardrobe, PRESETS.Ranger!);
        backgrounds.activate("forest");

        // Turntable spin (stops on first interaction). Clamp the zoom radius
        // every frame so wheel inertia settles within the allowed range.
        let spin = true;
        canvas.addEventListener("pointerdown", () => (spin = false));
        onBeforeRender(scene, (deltaMs) => {
            if (spin) {
                camera.alpha += deltaMs * 0.0002;
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

        wireUi(wardrobe, backgrounds);

        canvas.dataset.drawCalls = String(engine.drawCallCount);
        canvas.dataset.initMs = String(performance.now() - __initStart);
        canvas.dataset.ready = "true";
    } catch (err) {
        progress.done();
        canvas.dataset.error = String(err);
        console.error(err);
    }
}

// ─── Wardrobe (equipment state) ───────────────────────────────────────

interface SlotState {
    id: SlotId;
    label: string;
    optionIds: string[];
    optionLabels: Map<string, string>;
    parts: Map<string, OutfitPart>; // loaded options only ("none" absent)
    equipped: string;
}

interface Wardrobe {
    slots: SlotState[];
    byId: Map<SlotId, SlotState>;
}

async function buildWardrobe(engine: EngineContext, scene: SceneContext): Promise<Wardrobe> {
    const slots: SlotState[] = [];
    const byId = new Map<SlotId, SlotState>();
    for (const def of getCatalog()) {
        const parts = new Map<string, OutfitPart>();
        const optionLabels = new Map<string, string>();
        for (const opt of def.options) {
            optionLabels.set(opt.id, opt.label);
            if (opt.file) {
                const part = await loadPart(engine, scene, ASSET_BASE, opt.file);
                part.setVisible(false);
                parts.set(opt.id, part);
            }
        }
        const state: SlotState = {
            id: def.id,
            label: def.label,
            optionIds: def.options.map((o) => o.id),
            optionLabels,
            parts,
            equipped: "none",
        };
        slots.push(state);
        byId.set(def.id, state);
    }
    return { slots, byId };
}

function equip(slot: SlotState, optionId: string): void {
    if (slot.equipped === optionId) {
        return;
    }
    slot.parts.get(slot.equipped)?.setVisible(false);
    slot.parts.get(optionId)?.setVisible(true);
    slot.equipped = optionId;
}

function applyLoadout(wardrobe: Wardrobe, loadout: Record<SlotId, string>): void {
    for (const slot of wardrobe.slots) {
        equip(slot, loadout[slot.id] ?? "none");
    }
}

// ─── UI wiring ────────────────────────────────────────────────────────

function wireUi(wardrobe: Wardrobe, backgrounds: BackgroundController): void {
    const bodies = getBodies();
    const api: DressRoomApi = {
        bodies: bodies.map((b) => ({ id: b.id, label: b.label })),
        scenes: backgrounds.defs.map((d) => ({ id: d.id, label: d.label })),
        slots: wardrobe.slots.map((s) => ({
            id: s.id,
            label: s.label,
            options: s.optionIds.map((id) => ({ id, label: s.optionLabels.get(id) ?? id })),
        })),
        animations: [],
        presets: Object.keys(PRESETS),
        tintable: false,
        getBody: () => bodies[0]!.id,
        setBody: () => {},
        getScene: () => backgrounds.current(),
        setScene: (id) => backgrounds.activate(id),
        getOption: (slotId) => wardrobe.byId.get(slotId as SlotId)?.equipped ?? "none",
        setOption: (slotId, optionId) => {
            const slot = wardrobe.byId.get(slotId as SlotId);
            if (slot) {
                equip(slot, optionId);
            }
        },
        cycleOption: (slotId, dir) => {
            const slot = wardrobe.byId.get(slotId as SlotId);
            if (!slot) {
                return;
            }
            const idx = slot.optionIds.indexOf(slot.equipped);
            const nextIdx = (idx + dir + slot.optionIds.length) % slot.optionIds.length;
            equip(slot, slot.optionIds[nextIdx]!);
        },
        getAnimation: () => "",
        setAnimation: () => {},
        getTint: () => null,
        setTint: () => {},
        resetTint: () => {},
        randomize: () => {
            for (const slot of wardrobe.slots) {
                const pick = slot.optionIds[Math.floor(Math.random() * slot.optionIds.length)]!;
                equip(slot, pick);
            }
        },
        applyPreset: (name) => {
            const loadout = PRESETS[name];
            if (loadout) {
                applyLoadout(wardrobe, loadout);
            }
        },
    };
    buildPanel(api);
}

void main();
