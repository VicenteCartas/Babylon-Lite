import { createParticleBuffer, type ParticleBuffer } from "./particle-buffer.js";

/** @internal Floating-origin particle storage, loaded only by the LWR engine gate. */
export function createF64ParticleBuffer(capacity: number): ParticleBuffer {
    return createParticleBuffer(capacity, Float64Array);
}
