interface Input {
    name: string;
    inputName?: string;
    targetBlockId?: number;
    targetConnectionName?: string;
    valueType?: string;
    value?: unknown;
}

interface Block {
    customType: string;
    id: number;
    inputs: Input[];
    [key: string]: unknown;
}

function literal(name: string, value: unknown, valueType = "number"): Input {
    return { name, value, valueType };
}

function link(name: string, targetBlockId: number, targetConnectionName = "output"): Input {
    return { name, inputName: name, targetBlockId, targetConnectionName };
}

/** The exact serialized graph consumed by both engines; no engine-specific particle construction. */
export function createFeatureGraph(sceneId: number, textureUrl: string): object {
    const blocks: Block[] = [{ customType: "BABYLON.ParticleTextureSourceBlock", id: 900, url: textureUrl, invertY: true, inputs: [] }];
    const count = 1;
    const colors = [
        [0.15, 0.8, 1, 0.85],
        [1, 0.35, 0.18, 0.85],
        [0.6, 0.28, 1, 0.85],
        [0.3, 1, 0.45, 0.85],
    ];
    for (let branch = 0; branch < count; branch++) {
        const base = branch * 100;
        const add = (type: string, id: number, inputs: Input[], properties: Record<string, unknown> = {}): number => {
            blocks.push({ customType: `BABYLON.${type}`, id: base + id, inputs, ...properties });
            return base + id;
        };
        const input = (id: number, type: number, value: unknown, properties: Record<string, unknown> = {}): number =>
            add("ParticleInputBlock", id, [], {
                type,
                contextualValue: 0,
                systemSource: 0,
                value,
                valueType: type === 4 ? "BABYLON.Vector2" : type === 8 ? "BABYLON.Vector3" : "number",
                ...properties,
            });
        const x = 0;
        let flow = add("CreateParticleBlock", 1, [
            literal("lifeTime", sceneId === 333 ? 3 : 5),
            literal("emitPower", 1),
            literal("size", 0.18),
            literal("scale", sceneId === 334 ? [0.5, 2.2] : [1, 1], "BABYLON.Vector2"),
            literal("angle", 0),
            literal("color", colors[branch], "BABYLON.Color4"),
            literal("colorDead", [1, 0.1, 0.4, 0], "BABYLON.Color4"),
        ]);
        flow = add("BoxShapeBlock", 2, [
            link("particle", flow, "particle"),
            literal("minEmitBox", [x - (count > 1 ? 0.35 : 1.2), -0.6, -0.25], "BABYLON.Vector3"),
            literal("maxEmitBox", [x + (count > 1 ? 0.35 : 1.2), 0.5, 0.25], "BABYLON.Vector3"),
            literal("direction1", sceneId === 337 ? [0.03, 0.12, 0] : [0.15, 0.3, 0.1], "BABYLON.Vector3"),
            literal("direction2", sceneId === 337 ? [0.03, 0.12, 0] : [0.4, 0.8, 0.25], "BABYLON.Vector3"),
        ]);
        flow = add("BasicPositionUpdateBlock", 3, [link("particle", flow)]);
        flow = add("BasicColorUpdateBlock", 4, [link("particle", flow)]);
        if (sceneId === 332) {
            const scale = input(10, 4, [0.4, 2.3]);
            flow = add("UpdateScaleBlock", 5, [link("particle", flow), link("scale", scale)]);
            const age = input(11, 2, 0, { contextualValue: 3 });
            const factor = input(12, 2, 0.96);
            const slowedAge = add("ParticleMathBlock", 13, [link("left", age), link("right", factor)], { operation: 2 });
            flow = add("UpdateAgeBlock", 6, [link("particle", flow), link("age", slowedAge)]);
        }
        if (sceneId === 334) {
            const camera = input(10, 8, [0, 0, 0], { systemSource: 4 });
            const factor = input(11, 2, 0.12);
            const direction = add("ParticleMathBlock", 12, [link("left", camera), link("right", factor)], { operation: 2 });
            flow = add("UpdateDirectionBlock", 5, [link("particle", flow), link("direction", direction)]);
            flow = add("AlignAngleBlock", 6, [link("particle", flow)], { alignment: 0.4 });
        }
        const systemInputs = [link("particle", flow), link("texture", 900, "texture"), literal("emitRate", sceneId === 333 ? 30 : 0), literal("targetStopDuration", 0)];
        add("SystemBlock", 20, systemInputs, {
            name: `Feature ${sceneId} / ${branch}`,
            capacity: 160,
            updateSpeed: sceneId === 337 ? 0.05 : 0.0167,
            manualEmitCount: sceneId === 333 ? -1 : 48,
            preWarmCycles: sceneId === 333 ? 90 : 0,
            preWarmStepOffset: sceneId === 333 ? 2 : 1,
            blendMode: 2,
        });
    }
    return { blocks };
}
