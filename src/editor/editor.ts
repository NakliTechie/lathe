/**
 * The code pane — CodeMirror 6 (lighter than Monaco). Cmd/Ctrl+Enter runs the model
 * (handoff §10); editor-internal shortcuts stay with CodeMirror.
 */
import { EditorView, keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { indentWithTab } from "@codemirror/commands";
import { javascript } from "@codemirror/lang-javascript";
import { oneDark } from "@codemirror/theme-one-dark";
import { basicSetup } from "codemirror";

export function createEditor(parent: HTMLElement, doc: string, onRun: () => void): EditorView {
  // Highest precedence so Cmd/Ctrl+Enter beats any default binding.
  const runKeymap = Prec.highest(
    keymap.of([
      {
        key: "Mod-Enter",
        preventDefault: true,
        run: () => {
          onRun();
          return true;
        },
      },
    ]),
  );

  return new EditorView({
    parent,
    doc,
    extensions: [
      basicSetup,
      javascript({ typescript: true }),
      oneDark,
      runKeymap,
      keymap.of([indentWithTab]),
      EditorView.theme({
        "&": { height: "100%", backgroundColor: "transparent" },
        ".cm-scroller": { fontFamily: "var(--font-mono)", fontSize: "13px", lineHeight: "1.6" },
        ".cm-gutters": { backgroundColor: "transparent", border: "none" },
        "&.cm-focused": { outline: "none" },
      }),
    ],
  });
}

export function getDoc(view: EditorView): string {
  return view.state.doc.toString();
}
