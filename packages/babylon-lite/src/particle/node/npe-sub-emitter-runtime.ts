import type { Vec3 } from "../../math/types.js";
import { disposeParticleSystem, startParticleSystem, stopParticleSystem, type ParticleSystem } from "../particle-system.js";
import type { BuildNodeParticleOptions, NodeParticleSet } from "./npe-build.js";
import type { ParticleInputHandle } from "./npe-input.js";
import type { NodeParticleProgram, NodeParticleSystemPlan } from "./npe-types.js";

/** @internal One synchronously created system plus its asynchronous resource boundary. */
export interface NodeParticleSystemInstance {
    readonly system: ParticleSystem;
    readonly ready: Promise<void>;
}

/** @internal Set-local ownership and registration state for event-created systems. */
export interface NodeParticleChildHost {
    readonly children: ParticleSystem[];
    spawn(owner: ParticleSystem, plan: NodeParticleSystemPlan, emitter: Vec3, onDispose?: () => void): ParticleSystem | null;
    registerLive(register: (system: ParticleSystem) => void): () => void;
    dispose(): void;
}

/** @internal Create the optional set-local child host used by Phase 13 graphs. */
export function createNodeParticleChildHost(instantiate: (plan: NodeParticleSystemPlan, emitter: Vec3) => NodeParticleSystemInstance): NodeParticleChildHost {
    const children: ParticleSystem[] = [];
    const instances: NodeParticleSystemInstance[] = [];
    const owned = new Map<ParticleSystem, { children: ParticleSystem[]; previous?: () => void; dispose: () => void }>();
    let disposed = false;
    let registerChild: ((instance: NodeParticleSystemInstance) => void) | undefined;

    const host: NodeParticleChildHost = {
        children,
        spawn(owner, plan, emitter, onDispose) {
            if (disposed || owner._disposed) {
                return null;
            }
            const instance = instantiate(plan, { x: emitter.x, y: emitter.y, z: emitter.z });
            const child = instance.system;
            child.doNoStart = false;
            child.disposeOnStop = true;

            let ownership = owned.get(owner);
            if (!ownership) {
                const directChildren: ParticleSystem[] = [];
                const lifecycle = (owner._lifecycle ??= {});
                const previous = lifecycle._dispose;
                const dispose = () => {
                    while (directChildren.length) {
                        disposeParticleSystem(directChildren[directChildren.length - 1]!);
                    }
                    previous?.();
                };
                ownership = { children: directChildren, previous, dispose };
                owned.set(owner, ownership);
                lifecycle._dispose = dispose;
            }
            const ownerChildren = ownership.children;

            const childLifecycle = (child._lifecycle ??= {});
            // Templates with default lifecycle values skip the SystemBlock decorator, so install the drain-then-dispose step forced by disposeOnStop.
            childLifecycle._afterAnimate ??= () => {
                if (!child._started) {
                    disposeParticleSystem(child);
                } else if (child.manualEmitCount === 0) {
                    stopParticleSystem(child);
                }
            };
            const previousDispose = childLifecycle._dispose;
            childLifecycle._dispose = () => {
                previousDispose?.();
                const childIndex = children.indexOf(child);
                children.splice(childIndex, 1);
                instances.splice(childIndex, 1);
                const ownedIndex = ownerChildren.indexOf(child);
                ownerChildren.splice(ownedIndex, 1);
                if (ownerChildren.length === 0) {
                    owned.delete(owner);
                    if (owner._lifecycle?._dispose === ownership.dispose) {
                        owner._lifecycle._dispose = ownership.previous;
                    }
                }
                onDispose?.();
            };

            ownerChildren.push(child);
            children.push(child);
            instances.push(instance);
            registerChild?.(instance);
            startParticleSystem(child);
            void instance.ready.catch(() => disposeParticleSystem(child));
            return child;
        },
        registerLive(register) {
            registerChild = (instance) => {
                void instance.ready.then(
                    () => register(instance.system),
                    () => undefined
                );
            };
            for (const instance of instances) {
                registerChild(instance);
            }
            return () => {
                registerChild = undefined;
                host.dispose();
            };
        },
        dispose() {
            if (disposed) {
                return;
            }
            disposed = true;
            while (children.length) {
                disposeParticleSystem(children[children.length - 1]!);
            }
            owned.clear();
        },
    };
    return host;
}

/** @internal Instantiate a compiled program that owns event-created child systems. */
export async function buildNodeParticleSetWithSubEmitters(
    program: NodeParticleProgram,
    options: BuildNodeParticleOptions,
    inputs: Readonly<Record<string, ParticleInputHandle>>,
    instantiatePlan: (plan: NodeParticleSystemPlan, options: BuildNodeParticleOptions, buildPromises: Promise<void>[], host: NodeParticleChildHost) => ParticleSystem
): Promise<NodeParticleSet> {
    const instantiate = (plan: NodeParticleSystemPlan, childOptions: BuildNodeParticleOptions): NodeParticleSystemInstance => {
        const buildPromises: Promise<void>[] = [];
        const system = instantiatePlan(plan, childOptions, buildPromises, host);
        return { system, ready: Promise.all(buildPromises).then(() => undefined) };
    };
    const host = createNodeParticleChildHost((plan, emitter) => instantiate(plan, { emitter, textureBaseUrl: options.textureBaseUrl }));
    const instances = program._systems.map((plan) => instantiate(plan, options));

    await Promise.all(instances.map((instance) => instance.ready));
    return {
        systems: instances.map((instance) => instance.system),
        inputs,
        _children: host.children,
        _registerChildren: (register) => host.registerLive(register),
    };
}
