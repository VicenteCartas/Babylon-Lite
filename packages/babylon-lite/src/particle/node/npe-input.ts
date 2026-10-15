import type { Color4, Vec2, Vec3 } from "../../math/types.js";
import type { ParsedParticleBlock } from "./npe-types.js";
import type { NpeGetter, NpeValue } from "./npe-value.js";

const TYPE_INT = 0x0001;
const TYPE_FLOAT = 0x0002;
const TYPE_VECTOR2 = 0x0004;
const TYPE_VECTOR3 = 0x0008;
const TYPE_COLOR4 = 0x0080;

/** A live handle to one named Node Particle input. */
export interface ParticleInputHandle {
    readonly type: "i32" | "f32" | "vec2f" | "vec3f" | "vec4f";
    value: number | number[];
    readonly min: number;
    readonly max: number;
    readonly groupInInspector: string;
    readonly displayInInspector: boolean;
}

/** @internal */
export type NpeInputCell = NpeGetter;

/** @internal */
export function parseParticleInputValue(type: number, value: unknown): NpeValue;
/** @internal */
export function parseParticleInputValue(type: string | undefined, value: unknown): NpeValue | undefined;
export function parseParticleInputValue(type: number | string | undefined, value: unknown): NpeValue | undefined {
    if (typeof value === "number") {
        return value;
    }
    const serializedType = typeof type === "number";
    const array = Array.isArray(value) ? (value as number[]) : null;
    if (!array && !serializedType) {
        return undefined;
    }
    const [x = 0, y = 0, z = 0, a = 1] = array ?? [];
    switch (type) {
        case TYPE_INT:
        case TYPE_FLOAT:
            return 0;
        case TYPE_VECTOR2:
        case "BABYLON.Vector2":
            return { x, y } as Vec2;
        case TYPE_VECTOR3:
        case "BABYLON.Vector3":
            return { x, y, z } as Vec3;
        case TYPE_COLOR4:
        case "BABYLON.Color4":
            return { r: x, g: y, b: z, a } as Color4;
        default:
            return serializedType ? 0 : undefined;
    }
}

/** @internal */
export function createParticleInputHandles(blocks: readonly ParsedParticleBlock[]): {
    inputs: Readonly<Record<string, ParticleInputHandle>>;
    cells: ReadonlyMap<number, NpeInputCell>;
} {
    const inputs: Record<string, ParticleInputHandle> = Object.create(null) as Record<string, ParticleInputHandle>;
    const cells = new Map<number, NpeInputCell>();

    for (const block of blocks) {
        const serializedType = typeof block.type === "number" ? block.type : TYPE_FLOAT;
        const min = typeof block.min === "number" ? block.min : 0;
        const max = typeof block.max === "number" ? block.max : 0;
        let value = parseParticleInputValue(serializedType, block.value);
        inputs[block.name!] = {
            type:
                serializedType === TYPE_INT
                    ? "i32"
                    : serializedType === TYPE_VECTOR2
                      ? "vec2f"
                      : serializedType === TYPE_VECTOR3
                        ? "vec3f"
                        : serializedType === TYPE_COLOR4
                          ? "vec4f"
                          : "f32",
            min,
            max,
            groupInInspector: (block.groupInInspector as string | undefined) ?? "",
            displayInInspector: block.displayInInspector !== false,
            get value() {
                return typeof value === "number" ? value : Object.values(value);
            },
            set value(next: number | number[]) {
                value = parseParticleInputValue(serializedType, next);
                if (serializedType === TYPE_FLOAT && min !== max) {
                    value = (value as number) < min ? min : (value as number) > max ? max : value;
                }
            },
        };
        cells.set(block.id, () => value);
    }

    return { inputs, cells };
}
