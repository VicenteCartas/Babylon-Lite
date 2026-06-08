/** DOM control panel for the dress-room demo.
 *
 *  Pure DOM — no framework. The panel is a fixed overlay on the left edge of
 *  the canvas. It talks to the demo exclusively through the {@link DressRoomApi}
 *  the caller supplies, so this module knows nothing about Babylon Lite. */

/** A slot exposed to the UI. */
export interface UiSlot {
    id: string;
    label: string;
    options: { id: string; label: string }[];
}

/** The contract the demo provides to drive the panel. */
export interface DressRoomApi {
    /** Character class options (Knight / Mage / …). Omit or leave a single entry to hide the picker. */
    classes?: { id: string; label: string }[];
    /** Background scene options (forest, dungeon, …). Omit or leave a single entry to hide the picker. */
    scenes?: { id: string; label: string }[];
    /** Held-weapon options. Omit or leave a single entry to hide the picker. */
    weapons?: { id: string; label: string }[];
    /** Off-hand options (shields, spellbook, …). Omit or leave a single entry to hide the picker. */
    offhands?: { id: string; label: string }[];
    slots: UiSlot[];
    animations: string[];
    presets: string[];
    /** When false, the Armour Tint section is omitted (e.g. image-textured assets). */
    tintable?: boolean;
    getClass?(): string;
    setClass?(id: string): void;
    getScene?(): string;
    setScene?(id: string): void;
    getWeapon?(): string;
    setWeapon?(id: string): void;
    getOffhand?(): string;
    setOffhand?(id: string): void;
    getOption(slot: string): string;
    setOption(slot: string, optionId: string): void;
    cycleOption(slot: string, dir: 1 | -1): void;
    getAnimation(): string;
    setAnimation(name: string): void;
    /** Current tint for a slot's equipped piece, or null when nothing is equipped. */
    getTint(slot: string): [number, number, number] | null;
    setTint(slot: string, rgb: [number, number, number]): void;
    resetTint(slot: string): void;
    randomize(): void;
    applyPreset(name: string): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function toHex(rgb: [number, number, number]): string {
    const h = (v: number) =>
        Math.max(0, Math.min(255, Math.round(v * 255)))
            .toString(16)
            .padStart(2, "0");
    return `#${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`;
}

function fromHex(hex: string): [number, number, number] {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Build the panel, append it to the document, and wire it to `api`.
 *  Returns a `refresh()` that re-reads state into every control (call it after
 *  randomize / preset so the panel reflects the new loadout). */
export function buildPanel(api: DressRoomApi): { refresh: () => void } {
    injectStyles();
    const panel = el("div", "dr-panel");

    const title = el("div", "dr-title", "Dressing Room");
    panel.appendChild(title);
    panel.appendChild(el("div", "dr-rule"));

    const refreshers: (() => void)[] = []; // Reassigned by the tint section when present; a no-op otherwise so the
    // equipment arrows can always call it safely.
    let syncTint = (): void => {};
    /** Re-read state into every control. Used after actions that change more than
     *  one section (e.g. picking a class also sets that class's default weapon). */
    const refreshAll = (): void => {
        for (const fn of refreshers) {
            fn();
        }
    };

    // Collapsible "accordion" section: a header (title + current-value summary +
    // chevron) over a body that expands when the header is clicked. Only one
    // section is open at a time, keeping the panel compact as the catalogues grow.
    const accordions: HTMLElement[] = [];
    const makeAccordion = (heading: string, openByDefault = false): { section: HTMLElement; body: HTMLElement; valueEl: HTMLElement } => {
        const section = el("div", "dr-acc");
        if (openByDefault) {
            section.classList.add("is-open");
        }
        const header = el("button", "dr-acc-header");
        header.type = "button";
        const titleEl = el("span", "dr-acc-title", heading);
        const valueEl = el("span", "dr-acc-value");
        const chevron = el("span", "dr-acc-chevron", "▸");
        header.append(titleEl, valueEl, chevron);
        const body = el("div", "dr-acc-body");
        section.append(header, body);
        header.addEventListener("click", () => {
            const wasOpen = section.classList.contains("is-open");
            for (const a of accordions) {
                a.classList.remove("is-open");
            }
            if (!wasOpen) {
                section.classList.add("is-open");
            }
        });
        accordions.push(section);
        return { section, body, valueEl };
    };

    // ── Character class (only when more than one class is offered) ────
    if (api.classes && api.classes.length > 1 && api.getClass && api.setClass) {
        const { section, body, valueEl } = makeAccordion("Class", true);
        const classRow = el("div", "dr-acc-grid");
        const classButtons = new Map<string, HTMLButtonElement>();
        const syncClass = () => {
            const active = api.getClass!();
            for (const [id, btn] of classButtons) {
                btn.classList.toggle("is-active", id === active);
            }
            valueEl.textContent = api.classes!.find((c) => c.id === active)?.label ?? "";
        };
        for (const cls of api.classes) {
            const btn = el("button", "dr-chip", cls.label);
            btn.type = "button";
            btn.addEventListener("click", () => {
                api.setClass!(cls.id);
                refreshAll();
            });
            classButtons.set(cls.id, btn);
            classRow.appendChild(btn);
        }
        refreshers.push(syncClass);
        body.appendChild(classRow);
        panel.appendChild(section);
    }

    // ── Weapon (only when more than one weapon is offered) ────────────
    if (api.weapons && api.weapons.length > 1 && api.getWeapon && api.setWeapon) {
        const { section, body, valueEl } = makeAccordion("Weapon");
        const weaponRow = el("div", "dr-acc-grid");
        const weaponButtons = new Map<string, HTMLButtonElement>();
        const syncWeapon = () => {
            const active = api.getWeapon!();
            for (const [id, btn] of weaponButtons) {
                btn.classList.toggle("is-active", id === active);
            }
            valueEl.textContent = api.weapons!.find((w) => w.id === active)?.label ?? "";
        };
        for (const w of api.weapons) {
            const btn = el("button", "dr-chip", w.label);
            btn.type = "button";
            btn.addEventListener("click", () => {
                api.setWeapon!(w.id);
                refreshAll();
            });
            weaponButtons.set(w.id, btn);
            weaponRow.appendChild(btn);
        }
        refreshers.push(syncWeapon);
        body.appendChild(weaponRow);
        panel.appendChild(section);
    }

    // ── Off-hand (only when more than one option is offered) ──────────
    if (api.offhands && api.offhands.length > 1 && api.getOffhand && api.setOffhand) {
        const { section, body, valueEl } = makeAccordion("Off-hand");
        const offRow = el("div", "dr-acc-grid");
        const offButtons = new Map<string, HTMLButtonElement>();
        const syncOffhand = () => {
            const active = api.getOffhand!();
            for (const [id, btn] of offButtons) {
                btn.classList.toggle("is-active", id === active);
            }
            valueEl.textContent = api.offhands!.find((o) => o.id === active)?.label ?? "";
        };
        for (const o of api.offhands) {
            const btn = el("button", "dr-chip", o.label);
            btn.type = "button";
            btn.addEventListener("click", () => {
                api.setOffhand!(o.id);
                syncOffhand();
            });
            offButtons.set(o.id, btn);
            offRow.appendChild(btn);
        }
        refreshers.push(syncOffhand);
        body.appendChild(offRow);
        panel.appendChild(section);
    }

    // ── Background scene (only when more than one scene is offered) ────
    if (api.scenes && api.scenes.length > 1 && api.getScene && api.setScene) {
        const { section, body, valueEl } = makeAccordion("Scene");
        const sceneRow = el("div", "dr-acc-grid");
        const sceneButtons = new Map<string, HTMLButtonElement>();
        const syncScene = () => {
            const active = api.getScene!();
            for (const [id, btn] of sceneButtons) {
                btn.classList.toggle("is-active", id === active);
            }
            valueEl.textContent = api.scenes!.find((s) => s.id === active)?.label ?? "";
        };
        for (const sc of api.scenes) {
            const btn = el("button", "dr-chip", sc.label);
            btn.type = "button";
            btn.addEventListener("click", () => {
                api.setScene!(sc.id);
                syncScene();
            });
            sceneButtons.set(sc.id, btn);
            sceneRow.appendChild(btn);
        }
        refreshers.push(syncScene);
        body.appendChild(sceneRow);
        panel.appendChild(section);
    }

    // ── Equipment slots (only when the demo exposes slots) ───────────
    let tintSlotSelect: HTMLSelectElement | null = null;
    if (api.slots.length > 0) {
        const gearSection = el("div", "dr-section");
        gearSection.appendChild(el("div", "dr-heading", "Equipment"));
        for (const slot of api.slots) {
            const row = el("div", "dr-row");
            const prev = el("button", "dr-arrow", "‹");
            const name = el("div", "dr-slot-name");
            const next = el("button", "dr-arrow", "›");
            const label = el("div", "dr-slot-label", slot.label);

            const sync = () => {
                const current = api.getOption(slot.id);
                const opt = slot.options.find((o) => o.id === current);
                name.textContent = opt ? opt.label : current;
            };
            refreshers.push(sync);

            prev.addEventListener("click", () => {
                api.cycleOption(slot.id, -1);
                sync();
                syncTint();
            });
            next.addEventListener("click", () => {
                api.cycleOption(slot.id, 1);
                sync();
                syncTint();
            });

            const swatch = el("div", "dr-swatch-col");
            swatch.appendChild(label);
            const picker = el("div", "dr-picker");
            picker.append(prev, name, next);
            swatch.appendChild(picker);
            row.appendChild(swatch);
            gearSection.appendChild(row);
            sync();
        }
        panel.appendChild(gearSection);
    }

    // ── Animation switcher (only when the demo exposes animations) ────
    if (api.animations.length > 0) {
        const { section, body, valueEl } = makeAccordion("Animation");
        const animRow = el("div", "dr-acc-grid");
        const animButtons = new Map<string, HTMLButtonElement>();
        const syncAnim = () => {
            const active = api.getAnimation();
            for (const [anim, btn] of animButtons) {
                btn.classList.toggle("is-active", anim === active);
            }
            valueEl.textContent = active;
        };
        for (const anim of api.animations) {
            const btn = el("button", "dr-chip", anim);
            btn.type = "button";
            btn.addEventListener("click", () => {
                api.setAnimation(anim);
                syncAnim();
            });
            animButtons.set(anim, btn);
            animRow.appendChild(btn);
        }
        refreshers.push(syncAnim);
        body.appendChild(animRow);
        panel.appendChild(section);
    }

    // ── Armour tint (only when the demo's materials support tinting) ──
    if (api.tintable !== false) {
        const tintSection = el("div", "dr-section");
        tintSection.appendChild(el("div", "dr-heading", "Armour Tint"));
        const tintRow = el("div", "dr-row");
        tintSlotSelect = el("select", "dr-select");
        for (const slot of api.slots) {
            const opt = el("option");
            opt.value = slot.id;
            opt.textContent = slot.label;
            tintSlotSelect.appendChild(opt);
        }
        const color = el("input", "dr-color") as HTMLInputElement;
        color.type = "color";
        const resetTint = el("button", "dr-mini", "Reset");

        syncTint = () => {
            if (!tintSlotSelect) {
                return;
            }
            const slotId = tintSlotSelect.value;
            const tint = api.getTint(slotId);
            if (tint) {
                color.value = toHex(tint);
                color.disabled = false;
                resetTint.disabled = false;
            } else {
                color.disabled = true;
                resetTint.disabled = true;
            }
        };
        refreshers.push(syncTint);

        tintSlotSelect.addEventListener("change", syncTint);
        color.addEventListener("input", () => {
            if (tintSlotSelect) {
                api.setTint(tintSlotSelect.value, fromHex(color.value));
            }
        });
        resetTint.addEventListener("click", () => {
            if (tintSlotSelect) {
                api.resetTint(tintSlotSelect.value);
                syncTint();
            }
        });
        tintRow.append(tintSlotSelect, color, resetTint);
        tintSection.appendChild(tintRow);
        panel.appendChild(tintSection);
    }

    // ── Loadout (footer action; always reachable) ────────────────────
    const foot = el("div", "dr-foot");
    const randomize = el("button", "dr-randomize", "✦ Randomize") as HTMLButtonElement;
    randomize.type = "button";
    randomize.addEventListener("click", () => {
        api.randomize();
        refreshAll();
    });
    foot.appendChild(randomize);
    for (const preset of api.presets) {
        const btn = el("button", "dr-chip", preset);
        btn.type = "button";
        btn.addEventListener("click", () => {
            api.applyPreset(preset);
            refreshAll();
        });
        foot.appendChild(btn);
    }
    panel.appendChild(foot);

    const hint = el("div", "dr-hint", "Drag to orbit · scroll to zoom");
    panel.appendChild(hint);

    document.body.appendChild(panel);
    refreshAll();
    return { refresh: refreshAll };
}

function injectStyles(): void {
    if (document.getElementById("dr-style")) {
        return;
    }
    // Engraved display font for the fantasy headings (graceful serif fallback if
    // it can't load). Loaded via <link> rather than an `@import` in the injected
    // CSS — an `@import` inside `style.textContent` corrupts the rest of the rule
    // parsing in some browsers.
    if (!document.getElementById("dr-font")) {
        const link = el("link");
        link.id = "dr-font";
        link.rel = "stylesheet";
        link.href = "https://fonts.googleapis.com/css2?family=Cinzel:wght@500;700&display=swap";
        document.head.appendChild(link);
    }
    const style = el("style");
    style.id = "dr-style";
    style.textContent = `
.dr-panel {
  --gold: #d8b271; --gold-dim: #9c7b4a; --ember: #c8773f; --ember-deep: #9c4a1c;
  --parch: #ecdfce; --parch-dim: #b5a085; --ink: rgba(18,13,10,0.96);
  --display: "Cinzel", "Trajan Pro", "Iowan Old Style", Georgia, serif;
  position: fixed; top: 16px; left: 16px; z-index: 50;
  width: 258px; max-height: calc(100vh - 32px); overflow-y: auto;
  padding: 16px 15px 14px; box-sizing: border-box;
  background: linear-gradient(180deg, rgba(40,31,24,0.95), rgba(22,16,12,0.97));
  color: var(--parch);
  border: 1px solid rgba(150,110,60,0.6); border-radius: 10px;
  box-shadow: 0 10px 30px rgba(0,0,0,0.55), inset 0 0 0 1px rgba(216,178,113,0.12), inset 0 1px 0 rgba(255,224,170,0.1);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  backdrop-filter: blur(7px); user-select: none;
}
.dr-panel::-webkit-scrollbar { width: 8px; }
.dr-panel::-webkit-scrollbar-thumb { background: rgba(150,110,60,0.45); border-radius: 4px; }
.dr-panel::-webkit-scrollbar-track { background: transparent; }
.dr-title {
  font-family: var(--display); font-size: 1.22rem; font-weight: 700; text-align: center;
  letter-spacing: 1.6px; text-transform: uppercase; color: var(--gold);
  text-shadow: 0 1px 2px rgba(0,0,0,0.75), 0 0 12px rgba(216,178,113,0.25); margin: 2px 0 2px;
}
.dr-rule { height: 1px; margin: 9px 4px 14px; background: linear-gradient(90deg, transparent, rgba(216,178,113,0.6), transparent); }
.dr-rule::after {
  content: "✦"; display: block; text-align: center; color: var(--gold-dim);
  font-size: 0.6rem; margin-top: -7px; text-shadow: 0 0 6px rgba(0,0,0,0.8);
}
.dr-acc { margin-bottom: 8px; border: 1px solid rgba(150,110,60,0.28); border-radius: 8px; overflow: hidden; background: rgba(0,0,0,0.2); }
.dr-acc-header {
  width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 11px; cursor: pointer;
  background: linear-gradient(180deg, rgba(58,45,34,0.55), rgba(36,27,21,0.55)); border: none;
  color: var(--gold); font-family: var(--display); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1.2px;
}
.dr-acc-header:hover { background: linear-gradient(180deg, rgba(74,57,42,0.65), rgba(46,35,27,0.65)); }
.dr-acc-title { font-weight: 700; }
.dr-acc-value { margin-left: auto; color: var(--parch-dim); font-size: 0.78rem; font-family: system-ui, sans-serif; text-transform: none; letter-spacing: 0; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-acc-chevron { color: var(--gold-dim); transition: transform 0.25s ease; font-size: 0.66rem; }
.dr-acc.is-open .dr-acc-chevron { transform: rotate(90deg); }
.dr-acc-body { max-height: 0; overflow: hidden; transition: max-height 0.28s ease; }
.dr-acc.is-open .dr-acc-body { max-height: 520px; }
.dr-acc-grid { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 11px 12px; }
.dr-chip {
  padding: 6px 11px; border-radius: 7px; cursor: pointer; font-size: 0.8rem; color: var(--parch);
  background: linear-gradient(180deg, rgba(62,49,38,0.7), rgba(40,30,23,0.7));
  border: 1px solid rgba(150,110,60,0.32); transition: background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
}
.dr-chip:hover { border-color: rgba(216,178,113,0.65); background: linear-gradient(180deg, rgba(82,64,47,0.8), rgba(54,40,30,0.8)); }
.dr-chip.is-active {
  background: linear-gradient(180deg, var(--ember), var(--ember-deep)); border-color: var(--gold);
  color: #fff; font-weight: 600; box-shadow: 0 0 9px rgba(200,119,63,0.5);
}
.dr-foot { margin-top: 4px; }
.dr-randomize {
  width: 100%; padding: 10px; border-radius: 8px; cursor: pointer;
  background: linear-gradient(180deg, #6c4c2c, #46301a); border: 1px solid rgba(216,178,113,0.5);
  color: #f1e3ce; font-family: var(--display); text-transform: uppercase; letter-spacing: 1px; font-size: 0.78rem; font-weight: 700;
  transition: background 0.15s ease, box-shadow 0.15s ease;
}
.dr-randomize:hover { background: linear-gradient(180deg, #80592f, #573a1e); box-shadow: 0 0 10px rgba(200,119,63,0.4); }
.dr-hint { font-size: 0.68rem; color: #8c7d6e; text-align: center; margin-top: 10px; font-style: italic; }
/* Dormant equipment-slot + tint sections (re-themed for when Phase B enables them). */
.dr-section { margin-bottom: 14px; }
.dr-heading { font-family: var(--display); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 1.2px; color: var(--gold); margin-bottom: 6px; }
.dr-row { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
.dr-slot-label { font-size: 0.72rem; color: var(--parch-dim); margin-bottom: 2px; }
.dr-picker { display: flex; align-items: center; gap: 4px; }
.dr-swatch-col { flex: 1; }
.dr-slot-name { flex: 1; text-align: center; font-size: 0.85rem; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dr-arrow { width: 24px; height: 24px; border-radius: 6px; border: 1px solid rgba(150,110,60,0.32); cursor: pointer;
  background: rgba(62,49,38,0.7); color: var(--parch); font-size: 1rem; line-height: 1; }
.dr-arrow:hover { background: rgba(200,119,63,0.4); }
.dr-select { flex: 1; padding: 5px; border-radius: 6px; border: 1px solid rgba(150,110,60,0.32);
  background: rgba(40,30,23,0.8); color: var(--parch); font-size: 0.8rem; }
.dr-color { width: 36px; height: 28px; padding: 0; border: none; background: none; cursor: pointer; }
.dr-color:disabled { opacity: 0.35; cursor: not-allowed; }
.dr-mini { padding: 5px 8px; border-radius: 6px; border: 1px solid rgba(150,110,60,0.32); cursor: pointer;
  background: rgba(62,49,38,0.7); color: var(--parch); font-size: 0.72rem; }
.dr-mini:disabled { opacity: 0.35; cursor: not-allowed; }
`;
    document.head.appendChild(style);
}
