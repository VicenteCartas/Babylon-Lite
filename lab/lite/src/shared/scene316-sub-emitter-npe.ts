interface GraphInput {
    name: string;
    inputName?: string;
    targetBlockId?: number;
    targetConnectionName?: string;
    valueType?: string;
    value?: unknown;
}

interface GraphBlock {
    customType: string;
    id: number;
    inputs: GraphInput[];
    [field: string]: unknown;
}

interface BranchOptions {
    baseId: number;
    textureId: number;
    color: readonly [number, number, number, number];
    direction1: readonly [number, number, number];
    direction2: readonly [number, number, number];
    lifeTime: number;
    size: number;
    manualEmitCount: number;
    targetStopDuration: number;
    doNoStart: boolean;
}

interface Branch {
    blocks: GraphBlock[];
    flowId: number;
    system: GraphBlock;
}

function particleBranch(options: BranchOptions): Branch {
    const createId = options.baseId;
    const shapeId = options.baseId + 1;
    const positionId = options.baseId + 2;
    const colorId = options.baseId + 3;
    const systemId = options.baseId + 4;
    const create: GraphBlock = {
        customType: "BABYLON.CreateParticleBlock",
        id: createId,
        inputs: [
            { name: "emitPower", valueType: "number", value: 1 },
            { name: "lifeTime", valueType: "number", value: options.lifeTime },
            { name: "color", valueType: "BABYLON.Color4", value: options.color },
            { name: "colorDead", valueType: "BABYLON.Color4", value: [options.color[0], options.color[1], options.color[2], 0] },
            { name: "scale", valueType: "BABYLON.Vector2", value: [1, 1] },
            { name: "angle", valueType: "number", value: 0 },
            { name: "size", valueType: "number", value: options.size },
        ],
    };
    const shape: GraphBlock = {
        customType: "BABYLON.PointShapeBlock",
        id: shapeId,
        inputs: [
            { name: "particle", inputName: "particle", targetBlockId: createId, targetConnectionName: "particle" },
            { name: "direction1", valueType: "BABYLON.Vector3", value: options.direction1 },
            { name: "direction2", valueType: "BABYLON.Vector3", value: options.direction2 },
        ],
    };
    const position: GraphBlock = {
        customType: "BABYLON.BasicPositionUpdateBlock",
        id: positionId,
        inputs: [{ name: "particle", inputName: "particle", targetBlockId: shapeId, targetConnectionName: "output" }],
    };
    const color: GraphBlock = {
        customType: "BABYLON.BasicColorUpdateBlock",
        id: colorId,
        inputs: [{ name: "particle", inputName: "particle", targetBlockId: positionId, targetConnectionName: "output" }],
    };
    const system: GraphBlock = {
        customType: "BABYLON.SystemBlock",
        id: systemId,
        name: options.doNoStart ? `Child ${options.baseId}` : `Root ${options.baseId}`,
        capacity: 128,
        manualEmitCount: options.manualEmitCount,
        updateSpeed: 0.0167,
        preWarmStepOffset: 1,
        doNoStart: options.doNoStart,
        inputs: [
            { name: "particle", inputName: "particle", targetBlockId: colorId, targetConnectionName: "output" },
            { name: "emitRate", valueType: "number", value: 0 },
            { name: "texture", inputName: "texture", targetBlockId: options.textureId, targetConnectionName: "texture" },
            { name: "targetStopDuration", valueType: "number", value: options.targetStopDuration },
        ],
    };
    return { blocks: [create, shape, position, color, system], flowId: colorId, system };
}

function textureBlock(id: number, url: string): GraphBlock {
    return { customType: "BABYLON.ParticleTextureSourceBlock", id, url, inputs: [] };
}

/** Serialized graph shared by the Phase 13A Lite scene, Babylon oracle, and manual demo. */
export function createScene316TriggerGraph(url: string, delay = 0): object {
    const textureId = 900;
    const child = particleBranch({
        baseId: 100,
        textureId,
        color: [0.2, 0.95, 0.88, 0.9],
        direction1: [-1.1, -0.7, -0.2],
        direction2: [1.1, 0.7, 0.2],
        lifeTime: 0.85,
        size: 0.12,
        manualEmitCount: 10,
        targetStopDuration: 0.02,
        doNoStart: true,
    });
    const parent = particleBranch({
        baseId: 1,
        textureId,
        color: [1, 0.66, 0.24, 1],
        direction1: [0.25, 0.75, 0],
        direction2: [0.25, 0.75, 0],
        lifeTime: 8,
        size: 0.18,
        manualEmitCount: 1,
        targetStopDuration: 0,
        doNoStart: false,
    });
    const triggerId = 50;
    const trigger: GraphBlock = {
        customType: "BABYLON.ParticleTriggerBlock",
        id: triggerId,
        limit: 8,
        delay,
        inputs: [
            { name: "input", inputName: "input", targetBlockId: parent.flowId, targetConnectionName: "output" },
            { name: "condition", valueType: "number", value: 1 },
            { name: "system", inputName: "system", targetBlockId: child.system.id, targetConnectionName: "system" },
        ],
    };
    parent.system.inputs[0] = { name: "particle", inputName: "particle", targetBlockId: triggerId, targetConnectionName: "output" };
    return { blocks: [textureBlock(textureId, url), ...child.blocks, ...parent.blocks.slice(0, -1), trigger, parent.system] };
}

/** Serialized graph shared by the Phase 13B Lite scene, Babylon oracle, and manual demo. */
export function createScene317LifecycleGraph(url: string, targetStopDuration = 1.7): object {
    const textureId = 900;
    const startChild = particleBranch({
        baseId: 100,
        textureId,
        color: [0.24, 0.78, 1, 0.9],
        direction1: [-1.3, -1.3, -0.2],
        direction2: [1.3, 1.3, 0.2],
        lifeTime: 1.1,
        size: 0.14,
        manualEmitCount: 24,
        targetStopDuration: 0.02,
        doNoStart: true,
    });
    const endChild = particleBranch({
        baseId: 200,
        textureId,
        color: [1, 0.3, 0.52, 0.95],
        direction1: [-0.9, -0.9, -0.2],
        direction2: [0.9, 0.9, 0.2],
        lifeTime: 1.25,
        size: 0.17,
        manualEmitCount: 32,
        targetStopDuration: 0.02,
        doNoStart: true,
    });
    const parent = particleBranch({
        baseId: 1,
        textureId,
        color: [0.95, 0.95, 1, 0.72],
        direction1: [-0.25, 0.25, 0],
        direction2: [0.25, 0.65, 0],
        lifeTime: 2.4,
        size: 0.1,
        manualEmitCount: 18,
        targetStopDuration,
        doNoStart: false,
    });
    parent.system.inputs.push(
        { name: "onStart", inputName: "onStart", targetBlockId: startChild.system.id, targetConnectionName: "system" },
        { name: "onEnd", inputName: "onEnd", targetBlockId: endChild.system.id, targetConnectionName: "system" }
    );
    return { blocks: [textureBlock(textureId, url), ...startChild.blocks, ...endChild.blocks, ...parent.blocks] };
}
