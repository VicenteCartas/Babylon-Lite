import type { NpeBlockEvaluator } from "../npe-build.js";
import type { NpeGetter } from "../npe-value.js";

/** Publish a CPU-readable texture value only when a texture source feeds a CPU texture update. */
export const cpuTextureSourceBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const dataUrl = typeof block.textureDataUrl === "string" ? block.textureDataUrl : "";
        const rawUrl = dataUrl || (typeof block.url === "string" ? block.url : "");
        const base = ctx.state.textureBaseUrl;
        const absolute = /^(https?:)?\/\//.test(rawUrl) || rawUrl.startsWith("/");
        const url = /^(?!https?:|data:|blob:)[a-z][a-z\d+.-]*:/i.test(rawUrl) ? "" : rawUrl && base && !absolute ? new URL(rawUrl, base).href : rawUrl;
        const value = { url, invertY: block.invertY !== false };
        ctx.setOutput(block.id, "texture", (() => value) as unknown as NpeGetter);
    },
};
