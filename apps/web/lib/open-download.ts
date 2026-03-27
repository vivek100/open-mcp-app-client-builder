/**
 * Signed download URLs after async fetch: open a tab synchronously (user gesture),
 * then assign the URL so popup blockers do not block the download.
 */
export function openBlankDownloadTab(): Window | null {
  try {
    return window.open("about:blank", "_blank", "noopener,noreferrer");
  } catch {
    return null;
  }
}

export function navigateTabOrOpenUrl(tab: Window | null, url: string): void {
  if (tab && !tab.closed) {
    try {
      tab.location.href = url;
      return;
    } catch {
      try {
        tab.close();
      } catch {
        /* ignore */
      }
    }
  }
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  a.remove();
}
