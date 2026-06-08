/** Switchable 3D background scenes for the dress-room demo.
 *
 *  A "fantasy game dresser" backdrop: the figure stands on a neutral pedestal
 *  while the surrounding 3D environment (forest, dungeon, plains, …) can be
 *  swapped from the panel. Every scene is pre-built up front and toggled by
 *  visibility — the same pattern the wardrobe uses — so switching is instant and
 *  no geometry is added after `registerScene`.
 *
 *  The catalog is data-driven: a scene is either a set of procedural primitives
 *  (the placeholders below) or, once real art is available, a glTF environment
 *  ({@link BackgroundDef.gltf}). Dropping in a Quaternius CC0 environment pack is
 *  just adding catalog entries that point at the loaded glTF files. */

import {
    addToScene,
    createCylinder,
    createGround,
    createPbrMaterial,
    createSolidTexture2D,
    loadGltf,
    setFog,
    setSubtreeVisible,
} from "babylon-lite";
import type { DirectionalLight, EngineContext, HemisphericLight, Mesh, SceneContext, SceneNode } from "babylon-lite";

/** Shared lights a background tunes for mood (created once, persist across scenes). */
export interface SceneLights {
    hemi: HemisphericLight;
    /** Key light — casts the figure's shadow. */
    key: DirectionalLight;
    fill: DirectionalLight;
    rim: DirectionalLight;
}

/** Per-scene atmosphere applied when a background becomes active. */
interface Mood {
    /** Background / sky colour. */
    clearColor: [number, number, number];
    /** Linear-fog far fade so the ground melts into the sky/dark. */
    fog: { start: number; end: number; color: [number, number, number] };
    hemi: number;
    hemiGround?: [number, number, number];
    key: number;
    keyTint?: [number, number, number];
    fill: number;
    rim: number;
}

/** A selectable background scene. */
export interface BackgroundDef {
    id: string;
    label: string;
    mood: Mood;
    /** Real scenes: a single glTF environment filename under the demo asset folder. */
    gltf?: string;
    /** Assembled scenes: load + place multiple glTF kit pieces. Returns nodes to toggle. */
    assemble?: (engine: EngineContext, scene: SceneContext, baseUrl: string) => Promise<SceneNode[]>;
    /** Placeholders: build procedural geometry; returns the nodes to toggle. */
    build?: (engine: EngineContext, scene: SceneContext) => SceneNode[];
}

/** Ground plane Y — the figure's feet / pedestal sit here. */
const GROUND_Y = -0.12;

// ─── Small procedural helpers ─────────────────────────────────────────

function matte(engine: EngineContext, r: number, g: number, b: number, roughness = 0.9, environmentIntensity = 1.0): ReturnType<typeof createPbrMaterial> {
    return createPbrMaterial({
        baseColorTexture: createSolidTexture2D(engine, r, g, b, 1),
        ormTexture: createSolidTexture2D(engine, 1.0, roughness, 0.0, 1),
        environmentIntensity,
    });
}

function makeGround(engine: EngineContext, scene: SceneContext, color: [number, number, number], roughness: number, environmentIntensity = 1.0): Mesh {
    const ground = createGround(engine, { width: 80, height: 80, subdivisions: 2 });
    ground.material = matte(engine, color[0], color[1], color[2], roughness, environmentIntensity);
    ground.receiveShadows = false;
    ground.position.set(0, GROUND_Y, 0);
    addToScene(scene, ground);
    return ground;
}

/** A faceted low-poly conifer: a trunk plus two stacked cones. */
function makeTree(engine: EngineContext, scene: SceneContext, x: number, z: number, scale: number, foliage: [number, number, number]): Mesh[] {
    const trunkMat = matte(engine, 0.28, 0.18, 0.1, 0.95);
    const leafMat = matte(engine, foliage[0], foliage[1], foliage[2], 0.95);
    const trunk = createCylinder(engine, { height: 1.2 * scale, diameter: 0.26 * scale, tessellation: 8 });
    trunk.material = trunkMat;
    trunk.position.set(x, GROUND_Y + 0.6 * scale, z);
    addToScene(scene, trunk);
    const lower = createCylinder(engine, { height: 1.5 * scale, diameterTop: 0, diameterBottom: 1.7 * scale, tessellation: 8 });
    lower.material = leafMat;
    lower.position.set(x, GROUND_Y + 1.5 * scale, z);
    addToScene(scene, lower);
    const upper = createCylinder(engine, { height: 1.2 * scale, diameterTop: 0, diameterBottom: 1.2 * scale, tessellation: 8 });
    upper.material = leafMat;
    upper.position.set(x, GROUND_Y + 2.4 * scale, z);
    addToScene(scene, upper);
    return [trunk, lower, upper];
}

/** Place props in a ring, skipping the front wedge so the figure stays clear. */
function ringPositions(count: number, radius: number, jitter = 0): [number, number][] {
    const out: [number, number][] = [];
    for (let i = 0; i < count; i++) {
        const a = (i / count) * Math.PI * 2 + 0.35;
        const r = radius + (jitter ? (Math.sin(i * 12.9898) * 0.5 + 0.5) * jitter : 0);
        out.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    return out;
}

// ─── Placeholder scenes (procedural) ──────────────────────────────────
// Each returns every mesh it creates so the manager can show/hide the set.

function buildForest(engine: EngineContext, scene: SceneContext): SceneNode[] {
    const nodes: SceneNode[] = [makeGround(engine, scene, [0.16, 0.3, 0.12], 0.95)];
    const foliage: [number, number, number] = [0.12, 0.34, 0.14];
    for (const [x, z] of ringPositions(9, 8.5, 4)) {
        nodes.push(...makeTree(engine, scene, x, z, 1.1 + (((x * z) % 5) + 5) * 0.06, foliage));
    }
    return nodes;
}

function buildPlains(engine: EngineContext, scene: SceneContext): SceneNode[] {
    const nodes: SceneNode[] = [makeGround(engine, scene, [0.34, 0.26, 0.13], 0.95)];
    for (const [x, z] of ringPositions(7, 11, 5)) {
        nodes.push(...makeTree(engine, scene, x, z, 1.3, [0.3, 0.32, 0.12]));
    }
    return nodes;
}

// ─── KayKit dungeon (assembled from modular kit pieces) ───────────────
// Pieces are on a 4-unit grid: floor tiles are 4×4, walls 4 wide × 4 tall.
// The figure stands at the origin facing the camera (−Z, open side); walls
// enclose the back and sides, fading into fog.

const DUNGEON_DIR = "environments/dungeon/";

/** Mark every renderable mesh under a set of roots as a shadow receiver. */
function setReceiveShadows(roots: readonly SceneNode[]): void {
    const stack: SceneNode[] = [...roots];
    while (stack.length) {
        const n = stack.pop()!;
        if ((n as Mesh).material) {
            (n as Mesh).receiveShadows = true;
        }
        if (n.children?.length) {
            stack.push(...n.children);
        }
    }
}

/** Load one dungeon kit piece, place it, add it to the scene, return its roots.
 *  The loader applies an X-mirror on each glTF root (RH→LH); we keep that and
 *  only set position + Y-rotation, so symmetric kit pieces tile correctly. */
async function loadPiece(
    engine: EngineContext,
    scene: SceneContext,
    baseUrl: string,
    file: string,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    receiveShadows = false
): Promise<SceneNode[]> {
    const gltf = await loadGltf(engine, baseUrl + DUNGEON_DIR + file + ".gltf");
    const out: SceneNode[] = [];
    for (const entity of gltf.entities) {
        const node = entity as SceneNode;
        node.position.set(x, y, z);
        node.rotation.set(0, rotY, 0);
        addToScene(scene, node);
        out.push(node);
    }
    if (receiveShadows) {
        setReceiveShadows(out);
    }
    return out;
}

async function assembleDungeon(engine: EngineContext, scene: SceneContext, baseUrl: string): Promise<SceneNode[]> {
    const nodes: SceneNode[] = [];
    const FY = GROUND_Y; // floor sits just under the pedestal
    const HALF = Math.PI / 2;
    const add = async (file: string, x: number, y: number, z: number, rotY = 0): Promise<void> => {
        nodes.push(...(await loadPiece(engine, scene, baseUrl, file, x, y, z, rotY)));
    };

    // Floor — 3×3 grid of 4-unit tiles (spans −6..6), a few rocky variants mixed
    // in. The tiles under and behind the figure receive its cast shadow.
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const rocky = (i + j) % 2 === 0 && !(i === 0 && j === 0);
            const file = rocky ? "floor_tile_large_rocks" : "floor_tile_large";
            const catchShadow = i === 0 && j >= 0;
            nodes.push(...(await loadPiece(engine, scene, baseUrl, file, i * 4, FY, j * 4, 0, catchShadow)));
        }
    }

    // Back wall (far +Z edge) — three 4-wide panels.
    for (const x of [-4, 0, 4]) {
        await add("wall", x, FY, 6);
    }
    // Side walls (left −X, right +X), leaving the front (−Z, toward camera) open.
    for (const z of [0, 4]) {
        await add("wall", -6, FY, z, HALF);
        await add("wall", 6, FY, z, HALF);
    }

    // Decorated pillars framing the figure from the mid-sides.
    await add("pillar_decorated", -6, FY, -2, HALF);
    await add("pillar_decorated", 6, FY, -2, HALF);

    // A banner + two torches on the back wall for warmth and a focal point.
    await add("banner_red", 0, FY, 5.5);
    await add("torch", -3.4, FY, 5.4);
    await add("torch", 3.4, FY, 5.4);

    // A couple of props near the back corners for flavour.
    await add("chest", 4.6, FY, 4.8, -HALF);
    await add("keg", -4.8, FY, 4.9, HALF);

    return nodes;
}

/** The background catalog. Real KayKit scenes are assembled from kit pieces. */
export function getBackgrounds(): BackgroundDef[] {
    return [
        {
            id: "dungeon",
            label: "Dungeon",
            assemble: assembleDungeon,
            mood: {
                clearColor: [0.03, 0.025, 0.035],
                fog: { start: 9, end: 30, color: [0.03, 0.025, 0.035] },
                hemi: 0.55,
                hemiGround: [0.03, 0.025, 0.04],
                key: 1.9,
                keyTint: [1.0, 0.82, 0.6],
                fill: 0.35,
                rim: 0.7,
            },
        },
        {
            id: "forest",
            label: "Forest",
            build: buildForest,
            mood: {
                clearColor: [0.46, 0.62, 0.78],
                fog: { start: 16, end: 52, color: [0.5, 0.64, 0.78] },
                hemi: 1.0,
                hemiGround: [0.18, 0.22, 0.12],
                key: 2.4,
                keyTint: [1.0, 0.97, 0.86],
                fill: 0.8,
                rim: 0.6,
            },
        },
        {
            id: "plains",
            label: "Sunset Plains",
            build: buildPlains,
            mood: {
                clearColor: [0.62, 0.42, 0.27],
                fog: { start: 18, end: 60, color: [0.66, 0.45, 0.3] },
                hemi: 1.1,
                hemiGround: [0.3, 0.18, 0.1],
                key: 2.1,
                keyTint: [1.0, 0.8, 0.55],
                fill: 0.7,
                rim: 0.9,
            },
        },
    ];
}

/** Controls which background is visible and applies its atmosphere. */
export interface BackgroundController {
    readonly defs: BackgroundDef[];
    activate(id: string): void;
    current(): string;
}

/** Pre-build every background (hidden) and return a controller to switch them.
 *  glTF scenes are loaded up front; procedural scenes are built synchronously. */
export async function createBackgrounds(
    engine: EngineContext,
    scene: SceneContext,
    lights: SceneLights,
    baseUrl: string,
    defs: BackgroundDef[]
): Promise<BackgroundController> {
    const roots = new Map<string, SceneNode[]>();
    for (const def of defs) {
        let nodes: SceneNode[] = [];
        if (def.gltf) {
            const gltf = await loadGltf(engine, baseUrl + def.gltf);
            for (const entity of gltf.entities) {
                addToScene(scene, entity);
                nodes.push(entity as SceneNode);
            }
        } else if (def.assemble) {
            nodes = await def.assemble(engine, scene, baseUrl);
        } else if (def.build) {
            nodes = def.build(engine, scene);
        }
        for (const n of nodes) {
            setSubtreeVisible(n, false);
        }
        roots.set(def.id, nodes);
    }

    let active = "";
    const applyMood = (mood: Mood): void => {
        scene.clearColor = { r: mood.clearColor[0], g: mood.clearColor[1], b: mood.clearColor[2], a: 1.0 };
        setFog(scene, { mode: 3, density: 0, start: mood.fog.start, end: mood.fog.end, color: mood.fog.color });
        lights.hemi.intensity = mood.hemi;
        if (mood.hemiGround) {
            lights.hemi.groundColor = mood.hemiGround;
        }
        lights.key.intensity = mood.key;
        lights.key.diffuse = mood.keyTint ?? [1, 1, 1];
        lights.fill.intensity = mood.fill;
        lights.rim.intensity = mood.rim;
    };

    const activate = (id: string): void => {
        if (id === active) {
            return;
        }
        const def = defs.find((d) => d.id === id);
        if (!def) {
            return;
        }
        const prev = roots.get(active);
        if (prev) {
            for (const n of prev) {
                setSubtreeVisible(n, false);
            }
        }
        for (const n of roots.get(id) ?? []) {
            setSubtreeVisible(n, true);
        }
        applyMood(def.mood);
        active = id;
    };

    return { defs, activate, current: () => active };
}
