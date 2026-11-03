// Reuse unchanged DOM and focused controls when the clock changes a panel's status.
const key = node => node.nodeType === 1 ? JSON.stringify([node.tagName, node.id, node.getAttribute("name"), ...["act", "camp", "i", "g", "id", "tab", "set", "value"].map(k => node.dataset?.[k] ?? null)]) : node.nodeType;
function syncNode(node, next) {
  if (node.isEqualNode(next)) return;
  if (node.nodeType !== 1) { node.nodeValue = next.nodeValue; return; }
  for (const attr of [...node.attributes]) if (!next.hasAttribute(attr.name)) node.removeAttribute(attr.name);
  for (const attr of next.attributes) if (node.getAttribute(attr.name) !== attr.value) node.setAttribute(attr.name, attr.value);
  const value = next.value;
  syncChildren(node, next);
  if (node.tagName === "INPUT") { node.checked = next.checked; node.value = next.value; }
  if (node.tagName === "TEXTAREA") node.value = value;
  if (node.tagName === "SELECT") { for (const option of node.options) option.selected = option.value === value; }
}
function syncChildren(parent, next) {
  let at = parent.firstChild;
  for (const child of [...next.childNodes]) {
    if (!at) { parent.append(child); continue; }
    if (key(at) !== key(child)) {
      let match = at.nextSibling;
      while (match && key(match) !== key(child)) match = match.nextSibling;
      if (match) { parent.insertBefore(match, at); at = match; }
      else { parent.insertBefore(child, at); continue; }
    }
    syncNode(at, child);
    at = at.nextSibling;
  }
  while (at) { const next = at.nextSibling; at.remove(); at = next; }
}
export function renderPanel(root, html) {
  const template = document.createElement("template");
  // Lightweight non-DOM render fixtures still receive the exact generated markup.
  if (!template.content) { root.innerHTML = html; return; }
  template.innerHTML = html;
  const grip = root.querySelector(":scope > .kgr-grip");
  // The resize grip has listeners and is owned by heightGrip, outside generated markup.
  if (grip) template.content.append(grip.cloneNode(true));
  syncChildren(root, template.content);
}
