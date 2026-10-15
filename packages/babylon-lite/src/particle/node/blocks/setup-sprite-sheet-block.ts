import { useSpriteSheet } from "../../sprite-columns.js";
import type { NpeBlockEvaluator } from "../npe-build.js";

/**
 * `SetupSpriteSheetBlock` — configures the sprite-sheet feature. Allocates the sprite columns via
 * {@link useSpriteSheet} (only now, on this buffer), records the render cell dimensions + the per-particle
 * cell-index column + update step on the system's sprite handle, and attaches the birth hook that seeds a
 * new particle's cell state. A non-sprite system never reaches this block, so it allocates no sprite
 * columns and imports none of the sprite module.
 */
export const setupSpriteSheetBlock: NpeBlockEvaluator = {
    build(block, ctx) {
        const system = ctx.state.system!;
        const buffer = ctx.state.buffer!;
        const s = block;
        const start = typeof s.start === "number" ? s.start : 0;
        const end = typeof s.end === "number" ? s.end : 0;
        const sheet = useSpriteSheet(buffer, start, end, typeof s.loop === "boolean" ? s.loop : true, typeof s.spriteCellChangeSpeed === "number" ? s.spriteCellChangeSpeed : 1);
        system._spriteSheet = {
            cellWidth: typeof s.width === "number" ? s.width : 0,
            cellHeight: typeof s.height === "number" ? s.height : 0,
            startCellID: start,
            endCellID: end,
            cellIndex: sheet.cellIndex,
            update: sheet.update,
        };
        const previousColorDead = system.createColorDead;
        system.createColorDead = previousColorDead
            ? (i) => {
                  previousColorDead(i);
                  sheet.birth(i);
              }
            : sheet.birth;
    },
};
