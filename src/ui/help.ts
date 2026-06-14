/** In-app help (handoff §15), shown behind the `?` button. */
import { openModal } from "./modal";

const HELP_HTML = `
  <section class="help-section">
    <h3>Keyboard</h3>
    <ul class="help-keys">
      <li><kbd>Cmd/Ctrl</kbd> + <kbd>Enter</kbd> — Run</li>
      <li><kbd>Cmd/Ctrl</kbd> + <kbd>S</kbd> — Save model to disk</li>
      <li><kbd>Esc</kbd> — close this dialog / dismiss an error</li>
    </ul>
  </section>
  <section class="help-section">
    <h3>Three ways to build</h3>
    <p><strong>Write code</strong> in the left pane. <strong>Drag params</strong> on the right.
    Or <strong>prompt</strong> — describe a part and a model writes the code for you.</p>
  </section>
  <section class="help-section">
    <h3>How params work</h3>
    <p>Name a value in the <code>params</code> object and it becomes a control. Drag it to re-run
    live; <strong>Save to code</strong> writes the current value back into your source.</p>
  </section>
  <section class="help-section">
    <h3>Pick your AI</h3>
    <p>Behind the <strong>🔑</strong> button: Anthropic, OpenAI, any OpenAI-compatible endpoint
    (a local Ollama / LM Studio, OpenRouter, …), or a small coder model that runs <strong>on your
    GPU</strong> in this tab. Cloud keys are stored in your browser only (IndexedDB) and sent only
    to that provider — never to any Lathe server. The on-device option needs no key, no network.</p>
  </section>
  <section class="help-section">
    <h3>Where files go</h3>
    <p>Saved to your disk (or downloaded, on browsers without File System Access). Exports:
    <strong>STEP</strong> for manufacturing, <strong>STL</strong> for 3D printing.</p>
  </section>
  <section class="help-section">
    <h3>What runs where</h3>
    <p>The CAD kernel runs in your browser tab; geometry never leaves your machine. With the WebGPU
    model, even codegen is fully local. No accounts, no telemetry.</p>
  </section>
`;

export function openHelp(): void {
  openModal("Lathe — help", HELP_HTML);
}
