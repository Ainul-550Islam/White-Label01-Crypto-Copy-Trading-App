/** Saves a Blob as a file through a temporary object URL (browser only). */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.rel = "noopener";
    document.body.appendChild(link);
    link.click();
    link.remove();
  } finally {
    // Revoke after the click has been processed so the download can start.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}
