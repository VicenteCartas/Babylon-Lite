/** KayKit fantasy character classes for the dress-room demo.
 *
 *  Each "class" is a self-contained rigged KayKit character (.glb with embedded
 *  texture): Knight, Barbarian, Mage, Ranger, Rogue. They share one skeleton
 *  ("Rig_Medium") whose hand-socket bones (`handslot.l` / `handslot.r`) are
 *  purpose-built mount points for weapons and shields.
 *
 *  Art: "KayKit - Adventurers" by Kay Lousberg (https://kaylousberg.itch.io),
 *  released under CC0 1.0 (public domain). Assets are committed (downscaled)
 *  under lab/public/dress-room/ and copied next to the demo bundle at build
 *  time, so they load relative to the page. */

import { addToScene, loadGltf, setSubtreeVisible } from "babylon-lite";
import type { EngineContext, Mesh, SceneContext, SceneNode } from "babylon-lite";

/** A selectable character class. */
export interface CharacterClass {
    id: string;
    label: string;
    /** glTF/glb filename under the asset folder. */
    file: string;
}

/** A loaded, placed character. Toggle `setVisible` to show/hide the whole figure. */
export interface LoadedCharacter {
    id: string;
    /** Root nodes added to the scene. */
    roots: SceneNode[];
    /** Every renderable mesh (used as shadow casters). */
    meshes: Mesh[];
    /** glTF node name → SceneNode, for finding hand sockets (`handslot.r`, …). */
    nodeByName: Map<string, SceneNode>;
    setVisible(visible: boolean): void;
}

/** The character roster, in display order. */
export function getClasses(): CharacterClass[] {
    return [
        { id: "knight", label: "Knight", file: "characters/Knight.glb" },
        { id: "barbarian", label: "Barbarian", file: "characters/Barbarian.glb" },
        { id: "mage", label: "Mage", file: "characters/Mage.glb" },
        { id: "ranger", label: "Ranger", file: "characters/Ranger.glb" },
        { id: "rogue", label: "Rogue", file: "characters/Rogue.glb" },
        { id: "rogue_hooded", label: "Rogue (Hooded)", file: "characters/Rogue_Hooded.glb" },
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

/** Load one character glb, add its roots to the scene, and return a toggleable handle. */
export async function loadCharacter(engine: EngineContext, scene: SceneContext, baseUrl: string, cls: CharacterClass): Promise<LoadedCharacter> {
    const gltf = await loadGltf(engine, baseUrl + cls.file);
    const roots: SceneNode[] = [];
    for (const entity of gltf.entities) {
        addToScene(scene, entity);
        roots.push(entity as SceneNode);
    }
    const { meshes, nodeByName } = indexSubtree(roots);
    return {
        id: cls.id,
        roots,
        meshes,
        nodeByName,
        setVisible: (visible: boolean) => {
            for (const root of roots) {
                setSubtreeVisible(root, visible);
            }
        },
    };
}
