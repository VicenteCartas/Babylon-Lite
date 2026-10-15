import { describe, expect, it, vi } from "vitest";
import { registerNodeParticleSet } from "../../../packages/babylon-lite/src/particle/particle-scene";
import { createParticleSystem, disposeParticleSystem } from "../../../packages/babylon-lite/src/particle/particle-system";
import type { SceneContext } from "../../../packages/babylon-lite/src/scene/scene";
import type { Texture2D } from "../../../packages/babylon-lite/src/texture/texture-2d";

describe("particle scene registration", () => {
    it("keeps the next system ticking when a system disposes during its own tick", async () => {
        const first = createParticleSystem(1);
        const second = createParticleSystem(1);
        for (const system of [first, second]) {
            system.texture = { width: 1, height: 1 } as Texture2D;
            system._registerBillboard = () => () => undefined;
        }
        first._prepareFrame = vi.fn(() => disposeParticleSystem(first));
        second._prepareFrame = vi.fn();
        const scene = { _beforeRender: [], _disposables: [] } as unknown as SceneContext;
        registerNodeParticleSet(scene, { systems: [first, second], inputs: {} });
        const [disposedTick, remainingTick] = scene._beforeRender;

        for (const tick of scene._beforeRender) {
            tick(1000 / 60);
        }

        expect(first._disposed).toBe(true);
        expect(second._prepareFrame).toHaveBeenCalledOnce();
        expect(second._actualFrame).toBeGreaterThan(0);
        expect(scene._beforeRender).toEqual([disposedTick, remainingTick]);
        disposedTick!(1000 / 60);
        expect(first._prepareFrame).toHaveBeenCalledOnce();
        await Promise.resolve();
        expect(scene._beforeRender).toEqual([remainingTick]);
        scene._disposables.at(-1)!();
        await Promise.resolve();
    });
});
