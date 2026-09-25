// MAX can report a different usable height from the WebView visual viewport.
// Keep the browser fallback for older clients and shrink for the keyboard.
export function installViewportSizing() {
  const viewport = window.visualViewport;
  let hostSize: { height: number; width: number } | undefined;
  let revision = 0;
  let frame = 0;
  let disposed = false;

  const render = () => {
    if (disposed || (viewport && viewport.scale !== 1)) return;
    const active = document.activeElement;
    const editing = active instanceof HTMLElement &&
      active.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable="true"]');
    const browserHeight = viewport?.height ?? window.innerHeight;
    const hostHeight = hostSize?.width === window.innerWidth ? hostSize.height : undefined;
    const height = hostHeight === undefined ? browserHeight :
      editing ? Math.min(hostHeight, browserHeight) : hostHeight;
    document.documentElement.style.setProperty('--app-height', `${height}px`);
    if (editing) {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (document.activeElement === active) active.scrollIntoView({ block: 'nearest' });
      });
    }
  };

  const refresh = async () => {
    // Android MAX already places this WebView between its native bars.
    // Expose the bridge platform even when viewport sizing is unsupported.
    document.documentElement.dataset.maxPlatform = window.WebApp?.platform ?? '';
    render();
    const current = ++revision;
    const bridge = window.WebApp;
    if (!bridge?.platform || !bridge.getViewportSize) return;
    const cssWidth = window.innerWidth;
    try {
      const size = await bridge.getViewportSize();
      if (disposed || current !== revision || cssWidth !== window.innerWidth) return;
      const height = Number(size.height);
      const width = Number(size.width);
      // Convert both native dimensions together to the CSS viewport scale.
      hostSize = Number.isFinite(height) && height > 0 && Number.isFinite(width) && width > 0
        ? { height: height * cssWidth / width, width: cssWidth } : undefined;
    } catch {
      if (disposed || current !== revision) return;
      hostSize = undefined;
    }
    render();
  };

  const onFocus = () => {
    // focusout fires before document.activeElement has settled.
    queueMicrotask(() => { if (!disposed) void refresh(); });
  };
  void refresh();
  viewport?.addEventListener('resize', refresh);
  window.addEventListener('resize', refresh);
  window.addEventListener('pageshow', refresh);
  window.addEventListener('opora:max-ready', refresh);
  document.addEventListener('focusin', onFocus);
  document.addEventListener('focusout', onFocus);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    viewport?.removeEventListener('resize', refresh);
    window.removeEventListener('resize', refresh);
    window.removeEventListener('pageshow', refresh);
    window.removeEventListener('opora:max-ready', refresh);
    document.removeEventListener('focusin', onFocus);
    document.removeEventListener('focusout', onFocus);
  };
}
