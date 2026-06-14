/**
 * The param panel (G3). Introspects the model's declared `params` and renders typed
 * controls: number → slider + number input, boolean → toggle, string → text, and a
 * `string[]` declaration → select (enum). Editing a control re-runs the model live.
 */
import type { ParamValue, Params } from "../kernel/protocol";

export interface ParamPanel {
  /** Current resolved values (scalars; an enum resolves to the selected option). */
  values(): Params;
  /** Values shaped to write back into the source `params` literal (enum → reordered array). */
  writeback(): Record<string, ParamValue>;
}

export function createParamPanel(container: HTMLElement, declared: Params, onInput: () => void): ParamPanel {
  container.innerHTML = "";
  const values: Params = {};
  const order: string[] = [];

  for (const [key, decl] of Object.entries(declared)) {
    order.push(key);
    const row = document.createElement("div");
    row.className = "param";

    const label = document.createElement("label");
    label.className = "param-label";
    label.textContent = key;
    label.htmlFor = `p-${key}`;
    row.appendChild(label);

    const commit = (v: ParamValue) => {
      values[key] = v;
      onInput();
    };

    if (typeof decl === "number") {
      values[key] = decl;
      row.appendChild(numberControl(key, decl, commit));
    } else if (typeof decl === "boolean") {
      values[key] = decl;
      row.appendChild(boolControl(key, decl, commit));
    } else if (Array.isArray(decl)) {
      values[key] = decl[0];
      row.appendChild(enumControl(key, decl, commit));
    } else {
      values[key] = decl;
      row.appendChild(stringControl(key, decl, commit));
    }

    container.appendChild(row);
  }

  return {
    values: () => ({ ...values }),
    writeback: () => {
      const out: Record<string, ParamValue> = {};
      for (const key of order) {
        const decl = declared[key];
        if (Array.isArray(decl)) {
          const sel = values[key] as string;
          out[key] = [sel, ...decl.filter((o) => o !== sel)];
        } else {
          out[key] = values[key];
        }
      }
      return out;
    },
  };
}

function rangeFor(v: number): { min: number; max: number; step: number } {
  const mag = Math.abs(v) || 1;
  const step = mag < 2 ? 0.1 : mag < 50 ? 0.5 : 1;
  const min = v < 0 ? Math.floor(v * 2) : 0;
  const max = Math.max(v * 4, v + 10, 10);
  return { min, max, step };
}

function numberControl(key: string, value: number, commit: (v: number) => void): HTMLElement {
  const { min, max, step } = rangeFor(value);
  const wrap = document.createElement("div");
  wrap.className = "param-number";

  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  slider.setAttribute("aria-label", `${key} slider`);

  const num = document.createElement("input");
  num.type = "number";
  num.id = `p-${key}`;
  num.step = String(step);
  num.value = String(value);

  slider.addEventListener("input", () => {
    num.value = slider.value;
    commit(Number(slider.value));
  });
  num.addEventListener("input", () => {
    const v = Number(num.value);
    if (Number.isFinite(v)) {
      slider.value = String(Math.min(Math.max(v, min), max));
      commit(v);
    }
  });

  wrap.append(slider, num);
  return wrap;
}

function boolControl(key: string, value: boolean, commit: (v: boolean) => void): HTMLElement {
  const label = document.createElement("label");
  label.className = "param-toggle";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.id = `p-${key}`;
  input.checked = value;
  const track = document.createElement("span");
  track.className = "toggle-track";
  input.addEventListener("change", () => commit(input.checked));
  label.append(input, track);
  return label;
}

function enumControl(key: string, options: string[], commit: (v: string) => void): HTMLElement {
  const select = document.createElement("select");
  select.id = `p-${key}`;
  select.className = "param-select";
  for (const opt of options) {
    const o = document.createElement("option");
    o.value = opt;
    o.textContent = opt;
    select.appendChild(o);
  }
  select.value = options[0];
  select.addEventListener("change", () => commit(select.value));
  return select;
}

function stringControl(key: string, value: string, commit: (v: string) => void): HTMLElement {
  const input = document.createElement("input");
  input.type = "text";
  input.id = `p-${key}`;
  input.className = "param-text";
  input.value = value;
  input.addEventListener("input", () => commit(input.value));
  return input;
}
