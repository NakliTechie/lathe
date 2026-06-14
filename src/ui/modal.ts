/**
 * A small accessible modal (handoff §9: focus trapping + restore, Esc to close, visible
 * focus). Used for the help modal (§15). Backdrop click and Esc close it; focus is
 * trapped inside while open and restored to the trigger on close.
 */
export function openModal(title: string, bodyHTML: string): void {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const dialog = document.createElement("div");
  dialog.className = "modal";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", title);
  dialog.innerHTML = `
    <div class="modal-head">
      <h2 class="modal-title">${title}</h2>
      <button class="btn btn-icon modal-close" aria-label="Close">✕</button>
    </div>
    <div class="modal-body">${bodyHTML}</div>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  const focusable = (): HTMLElement[] =>
    [...dialog.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')].filter(
      (el) => !el.hasAttribute("disabled"),
    );

  function close(): void {
    overlay.remove();
    document.removeEventListener("keydown", onKey, true);
    previouslyFocused?.focus?.();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.stopPropagation();
      close();
      return;
    }
    if (e.key === "Tab") {
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  overlay.addEventListener("mousedown", (e) => {
    if (e.target === overlay) close();
  });
  dialog.querySelector<HTMLButtonElement>(".modal-close")!.addEventListener("click", close);
  document.addEventListener("keydown", onKey, true);

  (focusable()[0] ?? dialog).focus();
}
