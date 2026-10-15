import type { DrawBinding } from "./renderable.js";

/** @internal Optional feature-owned prefix comparator for transparent bindings. */
export type TransparentSortCompare = (left: DrawBinding, right: DrawBinding) => number;

let _transparentSortCompare: TransparentSortCompare | null = null;

/** @internal Install or clear the optional transparent prefix comparator. */
export function _registerTransparentSortCompare(compare: TransparentSortCompare | null): void {
    _transparentSortCompare = compare;
}

/** @internal Return the optional transparent prefix comparator. */
export function _getTransparentSortCompare(): TransparentSortCompare | null {
    return _transparentSortCompare;
}
