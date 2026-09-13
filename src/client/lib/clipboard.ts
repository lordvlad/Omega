/**
 * Copying text, including where the async Clipboard API does not exist.
 *
 * `navigator.clipboard` is gated on a secure context. omega is normally
 * reached over the LAN — `http://192.168.x.x:4500` — which is not one, so on
 * a phone the object is simply absent and every copy silently does nothing.
 * That is not an edge case here; it is the ordinary way this app is used away
 * from the machine running it.
 *
 * So the modern API is tried first and the `execCommand` path stands behind
 * it, which browsers still honour from inside a user gesture and which does
 * not care about the origin's scheme.
 */

/** Copy `text`, reporting whether it actually landed on the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;

  // Present only in a secure context, and can still reject when the
  // permission is denied, so a failure here falls through rather than ending
  // the attempt.
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the selection-based path.
    }
  }

  return copyBySelection(text);
}

/**
 * The pre-Clipboard-API copy: put the text in a field, select it, `copy`.
 *
 * Must be called from a user gesture, which a menu click is. The element
 * cannot be `display: none` or `visibility: hidden` — neither can hold a
 * selection — so it is placed off-screen and transparent instead.
 */
function copyBySelection(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("aria-hidden", "true");
  field.tabIndex = -1;
  Object.assign(field.style, {
    position: "fixed",
    top: "0",
    left: "0",
    width: "1px",
    height: "1px",
    padding: "0",
    border: "none",
    outline: "none",
    boxShadow: "none",
    background: "transparent",
    opacity: "0",
    // iOS zooms the viewport toward any focused field smaller than this, and
    // the zoom outlives the element.
    fontSize: "16px",
  });
  document.body.append(field);

  // Whatever the user had selected is theirs; taking it for a moment is
  // unavoidable, keeping it is not.
  const selection = document.getSelection();
  const previous = selection && selection.rangeCount > 0 ? selection.getRangeAt(0) : undefined;

  try {
    // iOS Safari ignores `select()` on a field it considers read-only, and
    // honours an explicit range over the contents instead.
    const range = document.createRange();
    range.selectNodeContents(field);
    selection?.removeAllRanges();
    selection?.addRange(range);
    field.setSelectionRange(0, text.length);
    field.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
    if (selection) {
      selection.removeAllRanges();
      if (previous) selection.addRange(previous);
    }
  }
}
