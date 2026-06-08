/** Switchable 3D background scenes for the dress-room demo.
 *
 *  A "fantasy game dresser" backdrop: the figure stands on the scene floor while
 *  the surrounding 3D environment (dungeon, forest, …) can be swapped from the
 *  panel. Every scene is pre-built up front and toggled by visibility — the same
 *  pattern the wardrobe uses — so switching is instant and no geometry is added
 *  after `registerScene`.
 *
 *  The catalog is data-driven: a scene is assembled from real KayKit CC0 kit
 *  pieces ({@link BackgroundDef.assemble}) — a torch-lit modular dungeon, a
 *  forest clearing — or, optionally, built procedurally ({@link BackgroundDef.build}).
 *  Adding another environment is just a new catalog entry. */

import {
    addToScene,
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
// (procedural placeholder trees removed — the forest is now assembled from real
//  KayKit Forest Nature kit pieces; see assembleForest below.)

// ─── KayKit assembled scenes (modular kit pieces) ─────────────────────
// Both the dungeon and the forest are assembled from real KayKit kit pieces.
// Dungeon pieces sit on a 4-unit grid (floor tiles 4×4, walls 4 wide × 4 tall);
// forest pieces are individual trees/rocks/bushes. The figure stands at the
// origin facing the camera (−Z, the open side); scenery encloses the back and
// sides and fades into fog. The ground plane helper above is their floor.

const DUNGEON_DIR = "environments/dungeon/";
const FOREST_DIR = "environments/forest/";

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

/** Load one kit piece from `dir`, place it, add it to the scene, return its roots.
 *  The loader applies an X-mirror on each glTF root (RH→LH); we keep that and
 *  only set position + Y-rotation (+ optional uniform scale), so symmetric kit
 *  pieces tile correctly. */
async function loadPiece(
    engine: EngineContext,
    scene: SceneContext,
    baseUrl: string,
    dir: string,
    file: string,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    scale = 1,
    receiveShadows = false
): Promise<SceneNode[]> {
    const gltf = await loadGltf(engine, baseUrl + dir + file + ".gltf");
    const out: SceneNode[] = [];
    for (const entity of gltf.entities) {
        const node = entity as SceneNode;
        node.position.set(x, y, z);
        node.rotation.set(0, rotY, 0);
        if (scale !== 1) {
            // The loader's synthetic root carries a −1 X scale (RH→LH); preserve
            // that sign so the piece isn't un-mirrored, then apply uniform scale.
            node.scaling.set(-scale, scale, scale);
        }
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
        nodes.push(...(await loadPiece(engine, scene, baseUrl, DUNGEON_DIR, file, x, y, z, rotY)));
    };

    // Floor — 3×3 grid of 4-unit tiles (spans −6..6), a few rocky variants mixed
    // in. The tiles under and behind the figure receive its cast shadow.
    for (let i = -1; i <= 1; i++) {
        for (let j = -1; j <= 1; j++) {
            const rocky = (i + j) % 2 === 0 && !(i === 0 && j === 0);
            const file = rocky ? "floor_tile_large_rocks" : "floor_tile_large";
            const catchShadow = i === 0 && j >= 0;
            nodes.push(...(await loadPiece(engine, scene, baseUrl, DUNGEON_DIR, file, i * 4, FY, j * 4, 0, 1, catchShadow)));
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

async function assembleForest(engine: EngineContext, scene: SceneContext, baseUrl: string): Promise<SceneNode[]> {
    const nodes: SceneNode[] = [makeGround(engine, scene, [0.19, 0.32, 0.15], 0.95)];
    const FY = GROUND_Y;
    // A cheap deterministic jitter so repeated layouts feel organic without RNG.
    const wobble = (seed: number): number => ((Math.sin(seed * 12.9898) * 43758.5453) % 1) * Math.PI * 2;
    const place = async (file: string, x: number, z: number, scale: number, seed: number): Promise<void> => {
        nodes.push(...(await loadPiece(engine, scene, baseUrl, FOREST_DIR, file, x, FY, z, wobble(seed), scale)));
    };

    // Trees ring the clearing — close enough that their trunks clearly meet the
    // ground near the figure (distant trees on a flat plane read as floating).
    // The front (toward the camera at −Z) is left open. KayKit trees are ~4 units
    // tall, towering over the 2.5-unit figure.
    const trees = ["Tree_1_A_Color1", "Tree_2_A_Color1", "Tree_3_A_Color1", "Tree_4_A_Color1", "Tree_Bare_1_A_Color1", "Tree_Bare_2_A_Color1"];
    const spots: [number, number, number][] = [
        [-3.4, 3.6, 1.0],
        [3.4, 3.6, 1.05],
        [-4.6, 0.6, 1.1],
        [4.6, 0.6, 1.0],
        [-2.6, 4.6, 0.95],
        [2.6, 4.8, 1.05],
        [0, 5.2, 1.15],
        [-5.4, -2.2, 0.95],
        [5.4, -2.2, 1.0],
    ];
    for (let i = 0; i < spots.length; i++) {
        const [x, z, s] = spots[i]!;
        await place(trees[i % trees.length]!, x, z, s, i + 1);
    }

    // Bushes + rocks fill the mid-ground at the tree line and scatter toward the
    // figure so the ground reads with depth instead of a flat void.
    const bushFiles = ["Bush_1_A_Color1", "Bush_2_A_Color1", "Bush_4_A_Color1"];
    const bushes: [number, number][] = [
        [-2.2, 2.4],
        [2.4, 2.6],
        [-3.6, 1.0],
        [3.6, 1.2],
        [-1.6, 3.6],
        [1.8, 3.8],
        [-2.8, -1.4],
        [2.8, -1.2],
    ];
    for (let i = 0; i < bushes.length; i++) {
        const [x, z] = bushes[i]!;
        await place(bushFiles[i % bushFiles.length]!, x, z, 2.4, i + 20);
    }
    const rockFiles = ["Rock_1_A_Color1", "Rock_2_A_Color1"];
    const rocks: [number, number][] = [
        [-1.8, 1.4],
        [1.9, 1.6],
        [-3.0, 3.0],
        [3.0, 2.0],
        [-1.4, -1.8],
        [1.6, -1.6],
    ];
    for (let i = 0; i < rocks.length; i++) {
        const [x, z] = rocks[i]!;
        await place(rockFiles[i % rockFiles.length]!, x, z, 1.5, i + 40);
    }
    // Grass tufts close to the figure for foreground detail.
    for (const [x, z, seed] of [
        [-1.2, 1.1, 60],
        [1.3, 1.3, 61],
        [-1.5, -0.8, 62],
        [1.4, -0.6, 63],
        [-0.8, 2.0, 64],
        [0.9, 2.1, 65],
    ] as [number, number, number][]) {
        await place("Grass_1_A_Color1", x, z, 2.2, seed);
    }

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
            assemble: assembleForest,
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
