/**
 * Racer input — the only module that touches keyboard events.
 *
 * Maps WASD / arrow keys to the two analog axes the vehicle controller consumes,
 * matching the Godot kit's `Input.get_axis` actions:
 *   • steer    — A/← = -1 (left)      D/→ = +1 (right)
 *   • throttle — S/↓ = -1 (reverse)   W/↑ = +1 (forward)
 */

/** Continuous per-frame control axes, each in the range [-1, 1]. */
export interface RacerAxes {
    steer: number;
    throttle: number;
}

const CONSUMED = new Set(["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"]);

export class RacerInput {
    private readonly _keys = new Set<string>();
    private readonly _canvas: HTMLCanvasElement;
    private readonly _onKeyDown: (e: KeyboardEvent) => void;
    private readonly _onKeyUp: (e: KeyboardEvent) => void;
    private readonly _onBlur: () => void;

    constructor(canvas: HTMLCanvasElement) {
        this._canvas = canvas;
        if (canvas.tabIndex < 0) {
            canvas.tabIndex = 0;
        }

        this._onKeyDown = (e: KeyboardEvent): void => {
            if (CONSUMED.has(e.code)) {
                e.preventDefault();
            }
            this._keys.add(e.code);
        };
        this._onKeyUp = (e: KeyboardEvent): void => {
            this._keys.delete(e.code);
        };
        this._onBlur = (): void => {
            this._keys.clear();
        };

        canvas.addEventListener("keydown", this._onKeyDown);
        canvas.addEventListener("keyup", this._onKeyUp);
        canvas.addEventListener("blur", this._onBlur);
        window.addEventListener("keydown", this._onKeyDown);
        window.addEventListener("keyup", this._onKeyUp);
    }

    /** Read the current control axes. */
    read(): RacerAxes {
        const k = this._keys;
        const left = k.has("KeyA") || k.has("ArrowLeft");
        const right = k.has("KeyD") || k.has("ArrowRight");
        const forward = k.has("KeyW") || k.has("ArrowUp");
        const back = k.has("KeyS") || k.has("ArrowDown");
        return {
            steer: (right ? 1 : 0) - (left ? 1 : 0),
            throttle: (forward ? 1 : 0) - (back ? 1 : 0),
        };
    }

    dispose(): void {
        this._canvas.removeEventListener("keydown", this._onKeyDown);
        this._canvas.removeEventListener("keyup", this._onKeyUp);
        this._canvas.removeEventListener("blur", this._onBlur);
        window.removeEventListener("keydown", this._onKeyDown);
        window.removeEventListener("keyup", this._onKeyUp);
        this._keys.clear();
    }
}
