export async function openActivityMonitor(): Promise<void> {
  if (typeof window.babuStudio?.openActivityMonitor !== "function") {
    window.alert("Restart Babu Studio to enable opening Activity Monitor.");
    return;
  }
  const opened = await window.babuStudio.openActivityMonitor();
  if (!opened) {
    window.alert("Activity Monitor could not be opened. Open it from Applications > Utilities.");
  }
}
