import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface SceneManifest {
    rawBytes?: number;
    gzipBytes?: number;
    runtimeChunks?: string[];
}

interface BundleInfo {
    chunks?: Array<{ file?: string; modules?: Array<{ id?: string }> }>;
}

const MANIFEST_DIR = resolve(__dirname, "../../../lab/public/bundle/manifest");
const BUNDLE_INFO_DIR = resolve(__dirname, "../../../lab/public/bundle/bundle-info");
const SCENE_305_SOURCE = resolve(__dirname, "../../../lab/lite/src/lite/scene305.ts");
const NPE_SOURCE_DIR = resolve(__dirname, "../../../packages/babylon-lite/src/particle/node");
const ENGINE_SOURCE = resolve(__dirname, "../../../packages/babylon-lite/src/engine/engine.ts");
const CANONICAL_PARTICLE_SCENES = [262, 263, 264, 276, 277, 280, 281, 283, 284];
const PROVIDER_ISOLATION_SCENES = [12, ...CANONICAL_PARTICLE_SCENES, 300, 301, 302];
const SPRITE_2D_BLEND_SCENES = [50, 300, 301];
const GRAPH_PLUMBING_SCENES = [...CANONICAL_PARTICLE_SCENES, 302, 305];
/** The per-scene manifests are build output, not tracked source, so the specs that
 *  read them self-skip in CI's Unit Tests job (which runs before any build). The
 *  Bundle Size job re-runs them after `pnpm build:bundle-scenes`, and local
 *  `pnpm test` builds first. Specs that assert on pure helpers always run. */
function hasManifests(sceneIds: readonly number[]): boolean {
    return sceneIds.every((sceneId) => existsSync(resolve(MANIFEST_DIR, `scene${sceneId}.json`)));
}
const HAS_MANIFEST = hasManifests(CANONICAL_PARTICLE_SCENES);
const HAS_MOVING_EMITTER_MANIFEST = hasManifests(PROVIDER_ISOLATION_SCENES);
const HAS_SPRITE_2D_MANIFEST = hasManifests(SPRITE_2D_BLEND_SCENES);
const UNUSED_FEATURE_CHUNK =
    /particle-(blend|billboard-modes|billboard-render-properties|billboard-renderable|billboard-scene|trigger-block)|registry-(variants|extra-basic|extra-emitters|extra-remaining|extra-values|input-extra|local-shapes|phase4b|value-math)|update-(attractor|flow-map|noise|direction|angle|scale|age|sprite-cell-index)-block|basic-(position|color)-update-block|npe-(blend-modes|emitter-provider|feature-compilation|flow-map-runtime|general-feature-compilation|graph-plumbing-runtime|live-emitter|noise-runtime|pack-billboard-modes|pack-camera|pack-core-updates|pack-render-properties|pack-sub-emitters|sprite-cell-compilation|sub-emitter-runtime|system-plan-compilation|value-compilation|texture-update-evaluator|texture-content)|cpu-texture-source|random-once-typed|random-composed-typed|setup-sprite-sheet-random|system-dynamic-emit-rate|particle-(clamp|condition|float-to-int|local-variable|math-int|nlerp|number-math|smooth-step|step|trigonometry|value-type|vector-length|vector-math)|particle-input-(local|sprite-cell)|local-position|box-shape-local|sphere-shape-local|point-shape|cone-shape|cylinder-shape|mesh-shape/;
const OPTIONAL_BLEND_MODULE = /particle\/(particle-(blend|billboard-renderable|billboard-scene)|node\/npe-blend-modes)/;
const OPTIONAL_RENDER_PROPERTIES_MODULE = /particle\/(particle-billboard-render-properties|node\/npe-pack-render-properties)/;
const OPTIONAL_BILLBOARD_MODES_MODULE = /particle\/(particle-billboard-modes(?:-pick)?|node\/npe-pack-billboard-modes)/;

function findUnusedFeatureChunks(sceneId: number, chunks: string[]): string[] {
    return chunks.filter(
        (chunk) =>
            UNUSED_FEATURE_CHUNK.test(chunk) &&
            !(sceneId === 263 && chunk.includes("registry-extra-emitters")) &&
            !(sceneId === 276 && /registry-(variants|input-extra)|particle-input-sprite-cell|update-sprite-cell-index/.test(chunk)) &&
            !(sceneId === 277 && (chunk.includes("registry-extra-remaining") || chunk.includes("update-attractor-block"))) &&
            !(sceneId === 280 && /npe-(feature-compilation|flow-map-runtime|texture-content)|update-flow-map-block|cpu-texture-source/.test(chunk)) &&
            !(sceneId === 281 && /npe-(feature-compilation|noise-runtime|texture-content)|update-noise-block|cpu-texture-source/.test(chunk)) &&
            !((sceneId === 283 || sceneId === 284) && /particle-(blend|billboard-renderable|billboard-scene)|npe-blend-modes/.test(chunk))
    );
}

describe("Particle bundle feature isolation", () => {
    it.skipIf(!hasManifests([276]))("records exact raw and gzip payload bytes", () => {
        const manifest = JSON.parse(readFileSync(resolve(MANIFEST_DIR, "scene276.json"), "utf8")) as SceneManifest;

        expect(manifest.rawBytes).toBeGreaterThan(0);
        expect(manifest.gzipBytes).toBeGreaterThan(0);
    });

    it("keeps value-math compilation behind the opt-in compiler boundary", () => {
        const build = readFileSync(resolve(NPE_SOURCE_DIR, "npe-build.ts"), "utf8");
        const featureCompiler = readFileSync(resolve(NPE_SOURCE_DIR, "npe-feature-compilation.ts"), "utf8");
        const generalCompiler = readFileSync(resolve(NPE_SOURCE_DIR, "npe-general-feature-compilation.ts"), "utf8");
        const valueCompilation = readFileSync(resolve(NPE_SOURCE_DIR, "npe-value-compilation.ts"), "utf8");
        const registry = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-value-math.ts"), "utf8");
        const baseRegistry = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry.ts"), "utf8");
        const extraRegistry = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-extra.ts"), "utf8");
        const phase4BRegistry = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-phase4b.ts"), "utf8");
        const variantRegistry = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-variants.ts"), "utf8");
        const variantRuntimeRegistry = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-variants-runtime.ts"), "utf8");
        const variantExtraRegistry = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-variants-extra.ts"), "utf8");
        const inputRegistry = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-input-extra.ts"), "utf8");
        const lifecyclePack = readFileSync(resolve(NPE_SOURCE_DIR, "npe-pack-lifecycle.ts"), "utf8");
        const standardValuePack = readFileSync(resolve(NPE_SOURCE_DIR, "npe-pack-standard-values.ts"), "utf8");
        const spritePack = readFileSync(resolve(NPE_SOURCE_DIR, "npe-pack-sprite.ts"), "utf8");
        const spriteCellFeatures = readFileSync(resolve(NPE_SOURCE_DIR, "npe-sprite-cell-features.ts"), "utf8");
        expect(build).toContain('import("./npe-feature-compilation.js")');
        expect(build.match(/import\("\.\/npe-registry-variants\.js"\)/g)).toHaveLength(1);
        expect(build).toContain("variants.c(blocks)");
        expect(baseRegistry.match(/import\("\.\/npe-registry-extra\.js"\)/g)).toHaveLength(1);
        expect(baseRegistry.match(/import\("\.\/npe-pack-lifecycle\.js"\)/g)).toHaveLength(1);
        expect(baseRegistry.match(/import\("\.\/npe-pack-standard-values\.js"\)/g)).toHaveLength(1);
        for (const moduleName of [
            "system-block",
            "create-particle-block",
            "texture-source-block",
            "update-position-block",
            "particle-input-block",
            "particle-random-block",
            "particle-math-compact-block",
            "particle-lerp-block",
            "particle-converter-block",
            "update-color-block",
        ]) {
            expect(baseRegistry).not.toContain(`blocks/${moduleName}`);
        }
        for (const moduleName of ["system-block", "create-particle-block", "texture-source-block", "update-position-block"]) {
            expect(lifecyclePack).toContain(`./blocks/${moduleName}.js`);
        }
        for (const moduleName of [
            "particle-input-block",
            "particle-random-block",
            "particle-math-compact-block",
            "particle-lerp-block",
            "particle-converter-block",
            "update-color-block",
        ]) {
            expect(standardValuePack).toContain(`./blocks/${moduleName}.js`);
        }
        expect(build).toContain("evaluator._inputEvaluators?.[input.name.trim()]");
        expect(featureCompiler).toContain('import("./npe-general-feature-compilation.js")');
        expect(featureCompiler).toContain('import("./npe-system-plan-compilation.js")');
        expect(build).not.toContain('import("./npe-system-plan-compilation.js")');
        expect(featureCompiler).toContain('import("./blocks/update-flow-map-block.js")');
        expect(featureCompiler).toContain('import("./blocks/update-noise-block.js")');
        expect(generalCompiler).toContain('import("./npe-value-compilation.js")');
        expect(valueCompilation).toContain('from "./blocks/particle-value-type.js"');
        expect(valueCompilation).toContain('from "./npe-registry-value-math.js"');
        expect(variantRegistry).toContain('import("./npe-registry-variants-runtime.js")');
        expect(variantRuntimeRegistry).toContain('import("./npe-registry-variants-extra.js")');
        expect(variantExtraRegistry).toContain('import("./npe-registry-input-extra.js")');
        expect(variantExtraRegistry).not.toContain("particle-input-sprite-cell-block");
        expect(variantRegistry.match(/import\("\.\/npe-pack-sprite\.js"\)/g)).toHaveLength(1);
        expect(variantRegistry.match(/import\("\.\/blocks\/particle-input-local-block\.js"\)/g)).toHaveLength(1);
        expect(variantRegistry).not.toContain("blocks/particle-input-sprite-cell-block");
        expect(variantExtraRegistry).not.toContain("blocks/particle-input-local-block");
        expect(extraRegistry.match(/import\("\.\/npe-pack-sprite\.js"\)/g)).toHaveLength(1);
        expect(spritePack).toContain('from "./blocks/particle-input-sprite-cell-block.js"');
        expect(spritePack).toContain('from "./blocks/update-sprite-cell-index-block.js"');
        expect(spritePack).toContain('import("./blocks/setup-sprite-sheet-random-block.js")');
        expect(variantRegistry).toContain('from "./npe-sprite-cell-features.js"');
        expect(spriteCellFeatures).toContain("detectSpriteCellFeatures");
        expect(spritePack).not.toContain("npe-sprite-cell-features");
        expect(inputRegistry).not.toContain("particle-input-sprite-cell-block");
        expect(inputRegistry).toContain('import("./blocks/particle-input-extra-block.js")');
        expect(existsSync(resolve(NPE_SOURCE_DIR, "npe-texture-update-evaluator.ts"))).toBe(false);
        for (const owner of ["npe-parser.ts", "npe-build.ts", "npe-registry.ts"]) {
            expect(readFileSync(resolve(NPE_SOURCE_DIR, owner), "utf8")).not.toContain("npe-value-compilation");
        }
        expect(registry).toContain('import("./blocks/particle-math-int-block.js")');
        for (const moduleName of ["particle-number-math-block", "particle-clamp-block", "particle-step-block"]) {
            expect(registry).toContain(`import("./blocks/${moduleName}.js")`);
            for (const owner of ["npe-parser.ts", "npe-build.ts", "npe-registry.ts"]) {
                expect(readFileSync(resolve(NPE_SOURCE_DIR, owner), "utf8")).not.toContain(`blocks/${moduleName}`);
            }
        }
        for (const moduleName of ["particle-trigonometry-block", "particle-vector-math-block", "particle-smooth-step-block", "particle-nlerp-block"]) {
            expect(phase4BRegistry).toContain(`import("./blocks/${moduleName}.js")`);
            for (const owner of ["npe-parser.ts", "npe-build.ts", "npe-registry.ts", "npe-registry-value-math.ts"]) {
                expect(readFileSync(resolve(NPE_SOURCE_DIR, owner), "utf8")).not.toContain(`blocks/${moduleName}`);
            }
        }
    });

    it("keeps optional storage owned by selected evaluators", () => {
        const compiler = readFileSync(resolve(NPE_SOURCE_DIR, "npe-compiler.ts"), "utf8");
        const localVariable = readFileSync(resolve(NPE_SOURCE_DIR, "blocks/particle-local-variable-block.ts"), "utf8");
        const spriteSheet = readFileSync(resolve(NPE_SOURCE_DIR, "blocks/setup-sprite-sheet-block.ts"), "utf8");

        expect(compiler).not.toContain("resource-compilation");
        expect(localVariable).toContain("column(buffer");
        expect(spriteSheet).toContain("useSpriteSheet(buffer");
    });

    it("keeps F64 particle storage behind the floating-origin engine gate", () => {
        const engine = readFileSync(ENGINE_SOURCE, "utf8");
        const build = readFileSync(resolve(NPE_SOURCE_DIR, "npe-build.ts"), "utf8");

        expect(engine).toContain('import("../particle/particle-buffer-f64.js")');
        expect(engine).not.toMatch(/from ["']\.\.\/particle\/particle-buffer-f64\.js["']/);
        expect(build).toContain("engine._createParticleBuffer?.(capacity)");
        expect(build).not.toContain("particle-buffer-f64");
    });

    it("routes core updates through one optional pack without changing the compiler", () => {
        const compiler = readFileSync(resolve(NPE_SOURCE_DIR, "npe-compiler.ts"), "utf8");
        const basicRegistry = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-extra-basic.ts"), "utf8");
        const corePack = readFileSync(resolve(NPE_SOURCE_DIR, "npe-pack-core-updates.ts"), "utf8");

        expect(basicRegistry.match(/import\("\.\/npe-pack-core-updates\.js"\)/g)).toHaveLength(1);
        for (const moduleName of ["update-scale-block", "update-age-block", "basic-position-update-block", "basic-color-update-block"]) {
            expect(corePack).toContain(`from "./blocks/${moduleName}.js"`);
            expect(compiler).not.toContain(moduleName);
        }
    });

    it("keeps SystemBlock render-property meaning in one optional evaluator and renderer", () => {
        const build = readFileSync(resolve(NPE_SOURCE_DIR, "npe-build.ts"), "utf8");
        const variants = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-variants.ts"), "utf8");
        const variantsRuntime = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-variants-runtime.ts"), "utf8");
        const pack = readFileSync(resolve(NPE_SOURCE_DIR, "npe-pack-render-properties.ts"), "utf8");
        const renderTask = readFileSync(resolve(NPE_SOURCE_DIR, "../../frame-graph/render-task.ts"), "utf8");

        expect(variants).toContain('import("./npe-registry-variants-runtime.js")');
        expect(variantsRuntime.match(/import\("\.\/npe-pack-render-properties\.js"\)/g)).toHaveLength(1);
        expect(pack).toContain('from "../particle-billboard-render-properties.js"');
        expect(build).not.toContain("particle-billboard-render-properties");
        expect(renderTask).not.toContain("_renderingGroupId");
        expect(renderTask).toContain("_getTransparentSortCompare");
    });

    it("keeps non-ALL particle geometry in one optional evaluator, renderer, and lazy picker", () => {
        const build = readFileSync(resolve(NPE_SOURCE_DIR, "npe-build.ts"), "utf8");
        const variants = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-variants.ts"), "utf8");
        const variantsRuntime = readFileSync(resolve(NPE_SOURCE_DIR, "npe-registry-variants-runtime.ts"), "utf8");
        const pack = readFileSync(resolve(NPE_SOURCE_DIR, "npe-pack-billboard-modes.ts"), "utf8");
        const scene = readFileSync(resolve(NPE_SOURCE_DIR, "../particle-scene.ts"), "utf8");
        const renderer = readFileSync(resolve(NPE_SOURCE_DIR, "../particle-billboard-modes.ts"), "utf8");

        expect(variants).toContain('import("./npe-registry-variants-runtime.js")');
        expect(variantsRuntime.match(/import\("\.\/npe-pack-billboard-modes\.js"\)/g)).toHaveLength(1);
        expect(variantsRuntime.indexOf('import("./npe-pack-billboard-modes.js")')).toBeLessThan(variantsRuntime.indexOf('import("./npe-pack-render-properties.js")'));
        expect(pack).toContain('from "../particle-billboard-modes.js"');
        expect(renderer).toContain('import("./particle-billboard-modes-pick.js")');
        expect(scene).toContain("system._syncBillboard ?? syncParticleBillboard");
        expect(build).not.toContain("particle-billboard-modes");
    });

    it("keeps sub-emitter evaluation and ownership behind system-flow compilation", () => {
        const build = readFileSync(resolve(NPE_SOURCE_DIR, "npe-build.ts"), "utf8");
        const featureCompiler = readFileSync(resolve(NPE_SOURCE_DIR, "npe-feature-compilation.ts"), "utf8");
        const pack = readFileSync(resolve(NPE_SOURCE_DIR, "npe-pack-sub-emitters.ts"), "utf8");

        expect(build).toContain('import("./npe-pack-sub-emitters.js")');
        expect(build).toContain('import("./npe-sub-emitter-runtime.js")');
        expect(build).toContain('import type { NodeParticleChildHost } from "./npe-sub-emitter-runtime.js"');
        expect(featureCompiler).toContain('import("./npe-system-plan-compilation.js")');
        expect(pack).toContain('from "./blocks/particle-trigger-block.js"');
        expect(pack).not.toContain('from "./blocks/system-block.js"');
    });

    it.skipIf(!hasManifests([262]))("keeps sub-emitter runtime out of scene262", () => {
        const manifest = JSON.parse(readFileSync(resolve(MANIFEST_DIR, "scene262.json"), "utf8")) as SceneManifest;
        const runtimeChunks = new Set(manifest.runtimeChunks ?? []);
        expect([...runtimeChunks].filter((chunk) => /npe-(pack-sub-emitters|sub-emitter-runtime)|particle-trigger-block/.test(chunk))).toEqual([]);

        const bundleInfo = JSON.parse(readFileSync(resolve(BUNDLE_INFO_DIR, "scene262.json"), "utf8")) as BundleInfo;
        const modules = (bundleInfo.chunks ?? [])
            .filter((chunk) => chunk.file && runtimeChunks.has(chunk.file))
            .flatMap((chunk) => chunk.modules ?? [])
            .map((module) => (module.id ?? "").replace(/\\/g, "/"))
            .filter((id) => /\/particle\/node\/(?:npe-(?:pack-sub-emitters|sub-emitter-runtime)|blocks\/particle-trigger-block)\.[jt]s$/.test(id));
        expect(modules).toEqual([]);
    });

    it.skipIf(!hasManifests([306, 307]))("fetches sub-emitter compilation, evaluation, and ownership only for Phase 13 scenes", () => {
        for (const sceneId of [306, 307]) {
            const manifest = JSON.parse(readFileSync(resolve(MANIFEST_DIR, `scene${sceneId}.json`), "utf8")) as SceneManifest;
            const runtimeChunks = new Set(manifest.runtimeChunks ?? []);
            expect(runtimeChunks.size, `scene${sceneId} has no runtime chunks recorded`).toBeGreaterThan(0);

            const bundleInfo = JSON.parse(readFileSync(resolve(BUNDLE_INFO_DIR, `scene${sceneId}.json`), "utf8")) as BundleInfo;
            const modules = (bundleInfo.chunks ?? [])
                .filter((chunk) => chunk.file && runtimeChunks.has(chunk.file))
                .flatMap((chunk) => chunk.modules ?? [])
                .map((module) => (module.id ?? "").replace(/\\/g, "/"));

            for (const moduleName of ["npe-feature-compilation", "npe-system-plan-compilation", "npe-pack-sub-emitters", "npe-sub-emitter-runtime"]) {
                expect(
                    modules.some((id) => new RegExp(`/particle/node/${moduleName}\\.[jt]s$`).test(id)),
                    `scene${sceneId} must fetch ${moduleName}`
                ).toBe(true);
            }
            expect(modules.some((id) => /\/particle\/node\/blocks\/particle-trigger-block\.[jt]s$/.test(id))).toBe(true);
        }
    });

    it.skipIf(!hasManifests([276]))("fetches no duplicate resource compiler for the sprite fixture", () => {
        const manifest = JSON.parse(readFileSync(resolve(MANIFEST_DIR, "scene276.json"), "utf8")) as SceneManifest;
        const chunks = manifest.runtimeChunks ?? [];

        expect(chunks.filter((chunk) => /npe-(sprite-)?resource-compilation/.test(chunk))).toEqual([]);
    });

    it.skipIf(!hasManifests([276, 302]))("fetches the sprite pack only for scene276", () => {
        const pattern = /npe-pack-sprite/;
        const spriteChunks = (JSON.parse(readFileSync(resolve(MANIFEST_DIR, "scene276.json"), "utf8")) as SceneManifest).runtimeChunks ?? [];
        const controlChunks = (JSON.parse(readFileSync(resolve(MANIFEST_DIR, "scene302.json"), "utf8")) as SceneManifest).runtimeChunks ?? [];

        expect(spriteChunks.filter((chunk) => pattern.test(chunk))).toHaveLength(1);
        expect(spriteChunks.filter((chunk) => /particle-input-sprite-cell|update-sprite-cell-index|setup-sprite-sheet-random/.test(chunk))).toEqual([]);
        expect(controlChunks.filter((chunk) => pattern.test(chunk))).toEqual([]);
        expect(controlChunks.filter((chunk) => /npe-pack-standard-values/.test(chunk))).toEqual([]);
    });

    it.skipIf(!hasManifests([262]))("keeps serialized-default render properties out of scene262", () => {
        const manifest = JSON.parse(readFileSync(resolve(MANIFEST_DIR, "scene262.json"), "utf8")) as SceneManifest;
        const runtimeChunks = new Set(manifest.runtimeChunks ?? []);
        expect([...runtimeChunks].filter((chunk) => /npe-pack-render-properties|particle-billboard-render-properties/.test(chunk))).toEqual([]);

        const bundleInfo = JSON.parse(readFileSync(resolve(BUNDLE_INFO_DIR, "scene262.json"), "utf8")) as BundleInfo;
        const modules = (bundleInfo.chunks ?? [])
            .filter((chunk) => chunk.file && runtimeChunks.has(chunk.file))
            .flatMap((chunk) => chunk.modules ?? [])
            .map((module) => module.id ?? "")
            .filter((id) => OPTIONAL_RENDER_PROPERTIES_MODULE.test(id));
        expect(modules).toEqual([]);
    });

    it.skipIf(!hasManifests([262]))("keeps serialized-default ALL geometry out of scene262", () => {
        const manifest = JSON.parse(readFileSync(resolve(MANIFEST_DIR, "scene262.json"), "utf8")) as SceneManifest;
        const runtimeChunks = new Set(manifest.runtimeChunks ?? []);
        expect([...runtimeChunks].filter((chunk) => /npe-pack-billboard-modes|particle-billboard-modes/.test(chunk))).toEqual([]);

        const bundleInfo = JSON.parse(readFileSync(resolve(BUNDLE_INFO_DIR, "scene262.json"), "utf8")) as BundleInfo;
        const modules = (bundleInfo.chunks ?? [])
            .filter((chunk) => chunk.file && runtimeChunks.has(chunk.file))
            .flatMap((chunk) => chunk.modules ?? [])
            .map((module) => module.id ?? "")
            .filter((id) => OPTIONAL_BILLBOARD_MODES_MODULE.test(id));
        expect(modules).toEqual([]);
    });

    it("keeps the frozen scene305 fixture free of camera controls", () => {
        expect(readFileSync(SCENE_305_SOURCE, "utf8")).not.toMatch(/\battachControl\b|arc-rotate-controls/);
    });

    it.skipIf(!HAS_MANIFEST)("canonical particle scenes do not fetch unused optional features", () => {
        for (const sceneId of CANONICAL_PARTICLE_SCENES) {
            const manifest = JSON.parse(readFileSync(resolve(MANIFEST_DIR, `scene${sceneId}.json`), "utf8")) as SceneManifest;
            const chunks = manifest.runtimeChunks ?? [];
            expect(chunks.length, `scene${sceneId} has no runtime chunks recorded`).toBeGreaterThan(0);
            expect(chunks.filter((chunk) => /npe-(flow-map|noise|texture-updates)-runtime/.test(chunk))).toEqual([]);
            const offenders = findUnusedFeatureChunks(sceneId, chunks);
            expect(offenders, `scene${sceneId} fetches unused particle feature chunks`).toEqual([]);
            if (sceneId === 277) {
                expect(
                    chunks.some((chunk) => chunk.includes("update-attractor-block")),
                    "scene277 must fetch the attractor evaluator"
                ).toBe(true);
                expect(
                    chunks.some((chunk) => chunk.includes("registry-extra-remaining")),
                    "scene277 must fetch the remaining optional registry"
                ).toBe(true);
            }
            if (sceneId === 280) {
                expect(
                    chunks.some((chunk) => chunk.includes("update-flow-map-block")),
                    "scene280 must fetch the compiled flow-map evaluator"
                ).toBe(true);
                expect(chunks.some((chunk) => chunk.includes("npe-feature-compilation"))).toBe(true);
                expect(chunks.some((chunk) => chunk.includes("npe-general-feature-compilation"))).toBe(false);
                expect(chunks.some((chunk) => chunk.includes("npe-texture-update-evaluator"))).toBe(false);
            }
            if (sceneId === 281) {
                expect(
                    chunks.some((chunk) => chunk.includes("update-noise-block")),
                    "scene281 must fetch the compiled noise evaluator"
                ).toBe(true);
                expect(chunks.some((chunk) => chunk.includes("npe-feature-compilation"))).toBe(true);
                expect(chunks.some((chunk) => chunk.includes("npe-general-feature-compilation"))).toBe(false);
                expect(chunks.some((chunk) => chunk.includes("npe-texture-update-evaluator"))).toBe(false);
            }
            const bundleInfoPath = resolve(BUNDLE_INFO_DIR, `scene${sceneId}.json`);
            if (!existsSync(bundleInfoPath)) {
                continue;
            }

            const runtimeChunks = new Set(chunks);
            const bundleInfo = JSON.parse(readFileSync(bundleInfoPath, "utf8")) as BundleInfo;
            const runtimeModuleIds = (bundleInfo.chunks ?? [])
                .filter((chunk) => chunk.file && runtimeChunks.has(chunk.file))
                .flatMap((chunk) => chunk.modules ?? [])
                .map((module) => module.id ?? "");
            expect(runtimeModuleIds.filter((id) => /npe-(flow-map|noise|texture-updates)-runtime/.test(id))).toEqual([]);
            if (sceneId === 283 || sceneId === 284) {
                expect(runtimeModuleIds.filter((id) => OPTIONAL_BLEND_MODULE.test(id))).toEqual(
                    expect.arrayContaining([
                        expect.stringContaining("particle-blend"),
                        expect.stringContaining("particle-billboard-renderable"),
                        expect.stringContaining("particle-billboard-scene"),
                        expect.stringContaining("npe-blend-modes"),
                    ])
                );
            } else {
                expect(
                    runtimeModuleIds.filter((id) => OPTIONAL_BLEND_MODULE.test(id)),
                    `scene${sceneId} must not fetch exact or advanced particle blend modules`
                ).toEqual([]);
            }
            const moduleOffenders = runtimeModuleIds.filter(
                (id) =>
                    /particle\/(particle-(billboard-modes(?:-pick)?|billboard-render-properties|billboard-renderable)|node\/(npe-(emitter-provider|feature-compilation|flow-map-runtime|general-feature-compilation|live-emitter|noise-runtime|pack-billboard-modes|pack-camera|pack-render-properties|pack-sub-emitters|sub-emitter-runtime|system-plan-compilation|value-compilation|texture-update-evaluator|local-position|texture-content)|npe-registry-(extra-remaining|extra-values|input-extra|local-shapes|phase4b|value-math)|blocks\/(cpu-texture-source-block|system-dynamic-emit-rate|particle-(clamp|condition|float-to-int|input-sprite-cell|local-variable|math-int|nlerp|number-math|smooth-step|step|trigonometry|trigger-block|value-type|vector-length|vector-math)|update-(attractor|flow-map|noise|sprite-cell-index)-block|(box|point|sphere|cone|cylinder|mesh)-shape-local)))|math\/mat4-invert/.test(
                        id
                    ) &&
                    !(sceneId === 276 && /npe-registry-input-extra|blocks\/(particle-input-sprite-cell|update-sprite-cell-index)-block/.test(id)) &&
                    !(sceneId === 277 && (id.includes("npe-registry-extra-remaining") || id.includes("update-attractor-block"))) &&
                    !(
                        sceneId === 280 &&
                        (id.includes("npe-flow-map-runtime") ||
                            id.includes("npe-feature-compilation") ||
                            id.includes("update-flow-map-block") ||
                            id.includes("cpu-texture-source-block") ||
                            id.includes("npe-texture-content"))
                    ) &&
                    !(
                        sceneId === 281 &&
                        (id.includes("npe-noise-runtime") ||
                            id.includes("npe-feature-compilation") ||
                            id.includes("update-noise-block") ||
                            id.includes("cpu-texture-source-block") ||
                            id.includes("npe-texture-content"))
                    ) &&
                    !((sceneId === 283 || sceneId === 284) && OPTIONAL_BLEND_MODULE.test(id))
            );
            expect(moduleOffenders, `scene${sceneId} folds unused optional particle features into runtime chunks`).toEqual([]);
        }
    });

    it.skipIf(!HAS_MOVING_EMITTER_MANIFEST)("keeps the moving-emitter provider isolated to scene302", () => {
        for (const sceneId of PROVIDER_ISOLATION_SCENES) {
            const manifest = JSON.parse(readFileSync(resolve(MANIFEST_DIR, `scene${sceneId}.json`), "utf8")) as SceneManifest;
            const runtimeChunks = new Set(manifest.runtimeChunks ?? []);
            expect(runtimeChunks.size, `scene${sceneId} has no runtime chunks recorded`).toBeGreaterThan(0);
            const providerChunks = [...runtimeChunks].filter((chunk) => /npe-(emitter-provider|live-emitter)/.test(chunk));
            if (sceneId !== 302) {
                expect(providerChunks, `scene${sceneId} must not fetch moving-emitter provider chunks`).toEqual([]);
            }

            const bundleInfoPath = resolve(BUNDLE_INFO_DIR, `scene${sceneId}.json`);
            if (!existsSync(bundleInfoPath)) {
                continue;
            }
            const bundleInfo = JSON.parse(readFileSync(bundleInfoPath, "utf8")) as BundleInfo;
            const providerModules = (bundleInfo.chunks ?? [])
                .filter((chunk) => chunk.file && runtimeChunks.has(chunk.file))
                .flatMap((chunk) => chunk.modules ?? [])
                .map((module) => module.id ?? "")
                .filter((id) => /\/particle\/node\/npe-(emitter-provider|live-emitter)\.[jt]s$/.test(id));
            if (sceneId === 302) {
                expect(providerModules).toEqual(expect.arrayContaining([expect.stringContaining("npe-emitter-provider")]));
                expect(providerModules.some((id) => id.includes("npe-live-emitter"))).toBe(false);
            } else {
                expect(providerModules, `scene${sceneId} must not fetch moving-emitter provider modules`).toEqual([]);
            }
        }
    });

    it.skipIf(!HAS_SPRITE_2D_MANIFEST)("keeps exact Sprite2D particle blending isolated to scene301", () => {
        for (const sceneId of SPRITE_2D_BLEND_SCENES) {
            const manifest = JSON.parse(readFileSync(resolve(MANIFEST_DIR, `scene${sceneId}.json`), "utf8")) as SceneManifest;
            const runtimeChunks = new Set(manifest.runtimeChunks ?? []);
            expect(runtimeChunks.size, `scene${sceneId} has no runtime chunks recorded`).toBeGreaterThan(0);

            const bundleInfoPath = resolve(BUNDLE_INFO_DIR, `scene${sceneId}.json`);
            if (!existsSync(bundleInfoPath)) {
                continue;
            }
            const bundleInfo = JSON.parse(readFileSync(bundleInfoPath, "utf8")) as BundleInfo;
            const runtimeModuleIds = (bundleInfo.chunks ?? [])
                .filter((chunk) => chunk.file && runtimeChunks.has(chunk.file))
                .flatMap((chunk) => chunk.modules ?? [])
                .map((module) => module.id ?? "");
            const exactModules = runtimeModuleIds.filter((id) => /\/(particle\/(particle-sprite-2d-blend-modes|particle-blend)|sprite\/sprite-custom-shader)\.[jt]s$/.test(id));

            if (sceneId === 301) {
                expect(exactModules).toEqual(
                    expect.arrayContaining([
                        expect.stringContaining("particle-sprite-2d-blend-modes"),
                        expect.stringContaining("particle-blend"),
                        expect.stringContaining("sprite-custom-shader"),
                    ])
                );
                const billboardOffenders = runtimeModuleIds.filter((id) =>
                    /\/(particle\/(particle-billboard-renderable|particle-billboard-scene|particle-scene)|sprite\/(sprite-renderable|billboard-(sprite|scene|renderable|pipeline)))\.[jt]s$/.test(
                        id
                    )
                );
                expect(billboardOffenders, "scene301 must not fetch billboard or scene-rendered sprite modules").toEqual([]);
            } else {
                expect(exactModules, `scene${sceneId} must not fetch exact Sprite2D particle blend modules`).toEqual([]);
            }
        }
    });

    for (const sceneId of GRAPH_PLUMBING_SCENES) {
        it.skipIf(!hasManifests([sceneId]))(`fetches graph plumbing and local storage only for the compiled graph in scene${sceneId}`, () => {
            const manifest = JSON.parse(readFileSync(resolve(MANIFEST_DIR, `scene${sceneId}.json`), "utf8")) as SceneManifest;
            const runtimeChunks = new Set(manifest.runtimeChunks ?? []);
            expect(runtimeChunks.size, `scene${sceneId} has no runtime chunks recorded`).toBeGreaterThan(0);
            const topologyChunks = [...runtimeChunks].filter((chunk) => chunk.includes("npe-graph-plumbing-runtime"));
            if (sceneId === 305) {
                expect(topologyChunks.length, "scene305 must fetch the graph-plumbing runtime chunk").toBeGreaterThan(0);
                expect(
                    [...runtimeChunks].filter((chunk) => chunk.includes("arc-rotate-controls")),
                    "scene305 must not fetch an arc-rotate-controls runtime chunk"
                ).toEqual([]);
            } else {
                expect(topologyChunks, `scene${sceneId} must not fetch the graph-plumbing runtime`).toEqual([]);
            }

            const bundleInfoPath = resolve(BUNDLE_INFO_DIR, `scene${sceneId}.json`);
            if (!existsSync(bundleInfoPath)) {
                return;
            }
            const bundleInfo = JSON.parse(readFileSync(bundleInfoPath, "utf8")) as BundleInfo;
            const runtimeModuleIds = (bundleInfo.chunks ?? [])
                .filter((chunk) => chunk.file && runtimeChunks.has(chunk.file))
                .flatMap((chunk) => chunk.modules ?? [])
                .map((module) => (module.id ?? "").replace(/\\/g, "/"));
            const compilerModules = runtimeModuleIds.filter((id) => /\/particle\/node\/npe-build\.[jt]s$/.test(id));
            const runtimeModules = runtimeModuleIds.filter((id) => /\/particle\/node\/npe-graph-plumbing-runtime\.[jt]s$/.test(id));
            const localModules = runtimeModuleIds.filter((id) => /\/particle\/node\/blocks\/particle-local-variable-block\.[jt]s$/.test(id));
            if (sceneId === 305) {
                expect(
                    runtimeModuleIds.filter((id) => /\/scene305-teleport-npe\.ts$/.test(id)),
                    "scene305 must keep its checked-in graph in the ignored *-npe.ts payload convention"
                ).toHaveLength(1);
                expect(compilerModules.length, "scene305 must fetch the node-particle build and compiler module").toBeGreaterThan(0);
                expect(runtimeModules.length, "scene305 must fetch the graph-plumbing runtime module").toBeGreaterThan(0);
                expect(localModules.length, "scene305 must fetch the Particle LocalVariable evaluator").toBeGreaterThan(0);
                expect(
                    runtimeModuleIds.filter((id) => /\/camera\/arc-rotate-controls\.[jt]s$/.test(id)),
                    "scene305 must not fetch the arc-rotate-controls runtime module"
                ).toEqual([]);
                const offenders = runtimeModuleIds.filter((id) =>
                    /\/particle\/(?:particle-(?:blend|sprite-2d|sprite-2d-blend-modes)|node\/npe-(?:blend-modes|emitter-provider|flow-map-runtime|noise-runtime|texture-update-runtime|texture-content))\.[jt]s$/.test(
                        id
                    )
                );
                expect(offenders, "scene305 must contain only default-builder graph plumbing").toEqual([]);
            } else {
                expect(runtimeModules, `scene${sceneId} must not fetch the heavy graph-plumbing runtime module`).toEqual([]);
                expect(localModules, `scene${sceneId} must not fetch the local evaluator`).toEqual([]);
            }
        });
    }
});
