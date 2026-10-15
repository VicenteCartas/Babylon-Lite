import {
    buildNodeParticleSet,
    compileNodeParticleGraph,
    createEngine,
    createSceneContext,
    createSpriteRenderer,
    parseNodeParticleSource,
    registerNodeParticleSet2D,
    registerSpriteRenderer,
    startEngine,
    type ParticleInputHandle,
} from "babylon-lite";
import { createNpeSprite2DFlareUrl, createNpeSprite2DGraph } from "../shared/npe-sprite2d-fixture.js";

interface MutableGraph {
    blocks: Array<Record<string, unknown>>;
}

function createLiveInputGraph(textureUrl: string): MutableGraph {
    const graph = createNpeSprite2DGraph(textureUrl) as MutableGraph;
    const system = graph.blocks.find((block) => block.customType === "BABYLON.SystemBlock");
    const sizeInput = graph.blocks.find((block) => block.customType === "BABYLON.ParticleInputBlock" && block.name === "Max size");
    if (!system || !sizeInput) {
        throw new Error("NPE live-input demo graph is missing its system or size input");
    }

    sizeInput.name = "Live size";
    sizeInput.min = 0.15;
    sizeInput.max = 1.5;
    sizeInput.groupInInspector = "Live controls";
    sizeInput.displayInInspector = true;

    const inputs = system.inputs as Array<Record<string, unknown>>;
    const particle = inputs.find((input) => input.name === "particle");
    if (!particle || typeof particle.targetBlockId !== "number" || typeof particle.targetConnectionName !== "string") {
        throw new Error("NPE live-input demo system has no particle flow");
    }

    graph.blocks.push({
        customType: "BABYLON.UpdateSizeBlock",
        id: 1000,
        name: "Live size update",
        inputs: [
            {
                name: "particle",
                targetBlockId: particle.targetBlockId,
                targetConnectionName: particle.targetConnectionName,
            },
            { name: "size", targetBlockId: sizeInput.id, targetConnectionName: "output" },
        ],
        outputs: [{ name: "output" }],
    });
    particle.targetBlockId = 1000;
    particle.targetConnectionName = "output";
    return graph;
}

function setSize(handle: ParticleInputHandle, slider: HTMLInputElement, output: HTMLOutputElement, value: number): void {
    handle.value = value;
    const stored = handle.value as number;
    slider.value = String(stored);
    output.value = stored.toFixed(2);
}

async function main(): Promise<void> {
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
    const slider = document.getElementById("liveSize") as HTMLInputElement;
    const output = document.getElementById("liveSizeValue") as HTMLOutputElement;
    const animate = document.getElementById("animateSize") as HTMLInputElement;
    const engine = await createEngine(canvas);
    const buildScene = createSceneContext(engine);
    const flareUrl = await createNpeSprite2DFlareUrl();
    let set: Awaited<ReturnType<typeof buildNodeParticleSet>>;
    try {
        const program = await compileNodeParticleGraph(parseNodeParticleSource(createLiveInputGraph(flareUrl)));
        set = await buildNodeParticleSet(engine, buildScene, program);
    } finally {
        URL.revokeObjectURL(flareUrl);
    }

    const liveSize = set.inputs["Live size"];
    if (!liveSize || liveSize.type !== "f32") {
        throw new Error("NPE live-input demo requires the Live size Float handle");
    }

    slider.min = String(liveSize.min);
    slider.max = String(liveSize.max);
    setSize(liveSize, slider, output, liveSize.value as number);
    slider.addEventListener("input", () => {
        animate.checked = false;
        setSize(liveSize, slider, output, Number(slider.value));
    });

    const renderer = createSpriteRenderer(engine, {
        layers: [],
        clearValue: { r: 0.012, g: 0.018, b: 0.024, a: 1 },
    });
    const binding = registerNodeParticleSet2D(renderer, set, {
        pixelsPerUnit: 190,
        layer: { order: 1 },
    });
    const bridge = binding.bridges[0]!;
    registerSpriteRenderer(renderer);
    await startEngine(engine);

    const start = performance.now();
    const tick = (time: number): void => {
        if (animate.checked) {
            const phase = (time - start) / 850;
            const value = liveSize.min + (liveSize.max - liveSize.min) * (0.5 + Math.sin(phase) * 0.5);
            setSize(liveSize, slider, output, value);
        }
        bridge.originPx[0] = canvas.width * 0.5;
        bridge.originPx[1] = canvas.height * 0.7;
        canvas.dataset.liveInput = String(liveSize.value);
        canvas.dataset.particles = String(bridge.system.buffer.alive);
        requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    canvas.dataset.ready = "true";
}

main().catch((error: unknown) => {
    console.error(error);
    const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement | null;
    if (canvas) {
        canvas.dataset.error = error instanceof Error ? error.message : String(error);
    }
});
