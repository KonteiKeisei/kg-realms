// A journal entry or page dropped on a place card's edit form (from the Journal sidebar or a
// compendium): its UUID, so its text can be copied in once. Nothing links to or opens a journal.

const KINDS = new Set(["JournalEntry", "JournalEntryPage"]);

/** The UUID of a journal entry or page in a drop, or null. */
export function journalFromDrop(event) {
  let data = null;
  try {
    const TE = foundry.applications?.ux?.TextEditor?.implementation ?? globalThis.TextEditor;
    data = TE?.getDragEventData?.(event) ?? null;
  } catch { /* not JSON */ }
  if (!data) try { data = JSON.parse(event.dataTransfer?.getData("text/plain") ?? ""); } catch { return null; }
  if (!data?.uuid || !KINDS.has(data.type)) return null;
  return data.uuid;
}
