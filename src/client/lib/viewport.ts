/**
 * The visible viewport, as a CSS variable.
 *
 * Mobile browsers shrink the *visual* viewport when the on-screen keyboard
 * opens, while the layout viewport — what `100dvh` measures — stays the height
 * of the whole screen. A chat column sized to the layout viewport therefore
 * puts its composer underneath the keyboard, and the reader has to scroll it
 * back into view before they can see what they are typing.
 *
 * Publishing `visualViewport.height` as `--omega-vvh` makes the column shorter
 * instead, so the composer stays at its bottom edge and the transcript above
 * it keeps tailing. `--omega-vvo` carries the viewport's offset, which iOS
 * uses when it scrolls the page under a focused field rather than resizing.
 */
import { useEffect } from "react";

/**
 * Track the visual viewport for as long as the app is mounted.
 *
 * Called once, from the shell. Nothing is returned: the values are consumed by
 * CSS, and routing them through React state would re-render the whole
 * conversation on every keyboard animation frame.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;

    const root = document.documentElement;
    const publish = (): void => {
      root.style.setProperty("--omega-vvh", `${Math.round(viewport.height)}px`);
      root.style.setProperty("--omega-vvo", `${Math.round(viewport.offsetTop)}px`);
    };
    publish();

    viewport.addEventListener("resize", publish);
    // iOS pans the page instead of resizing when a field is focused near the
    // bottom; the offset only shows up in scroll events.
    viewport.addEventListener("scroll", publish);
    return () => {
      viewport.removeEventListener("resize", publish);
      viewport.removeEventListener("scroll", publish);
      root.style.removeProperty("--omega-vvh");
      root.style.removeProperty("--omega-vvo");
    };
  }, []);
}
