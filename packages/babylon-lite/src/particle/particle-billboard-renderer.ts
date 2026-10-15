/**
 * The single lazy entry through which particle renderers reach the shared billboard pipeline.
 * Optional particle renderers obtain these helpers by dynamically importing this module instead of importing
 * them statically: a second static consumer would make Rollup hoist them out of the default renderer chunk
 * into separate shared chunks that every particle scene would then fetch.
 */
export { buildBillboardRenderable } from "../sprite/billboard-renderable.js";
export {
    BILLBOARD_INDEX_DATA,
    BILLBOARD_SYSTEM_UBO_BYTES,
    buildBillboardSystemUbo,
    createBillboardPipelineCache,
    createBillboardSystemBindGroup,
    getOrCreateBillboardPipeline,
    makeBillboardBasisWgsl,
    resetBillboardPipelineCache,
    writeBillboardSystemUboIfDirty,
} from "../sprite/billboard-pipeline.js";
export { createEmptyUniformBuffer } from "../resource/empty-uniform-buffer.js";
export { createMappedBuffer } from "../resource/mapped-buffer.js";
export { SCENE_UBO_WGSL } from "../shader/scene-uniforms.js";
