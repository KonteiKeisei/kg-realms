/** Mount an editor in the existing HUD without discarding its travel view. */
export function mountHudEditor(hud, editor) {
  if (!hud) {
    document.body.append(editor);
    return null;
  }
  hud.classList.add("kgr-editing");
  editor.classList.add("kgr-hud-editor");
  hud.append(editor);
  return hud;
}

export function unmountHudEditor(hud, editor) {
  editor?.remove();
  hud?.classList.remove("kgr-editing");
}
