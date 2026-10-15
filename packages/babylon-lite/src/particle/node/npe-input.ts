import type { Color4, Vec2, Vec3 } from "../../math/types.js";
import type { NpeValue } from "./npe-value.js";

const TYPE_INT = 0x0001;
const TYPE_FLOAT = 0x0002;
const TYPE_VECTOR2 = 0x0004;
const TYPE_VECTOR3 = 0x0008;
const TYPE_COLOR4 = 0x0080;

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
