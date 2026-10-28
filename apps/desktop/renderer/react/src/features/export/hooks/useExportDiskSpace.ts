import { useEffect, useState } from "react";

export function useExportDiskSpace(exportPickerOpen: boolean) {
  const [exportFreeBytes, setExportFreeBytes] = useState<number | null>(null);

  useEffect(() => {
    if (!exportPickerOpen) {
      return;
    }
    let cancelled = false;
    window.babuStudio.getSystemStats()
      .then((stats) => {
        if (!cancelled) {
          setExportFreeBytes(stats.disk.totalBytes > 0 ? stats.disk.freeBytes : null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setExportFreeBytes(null);
        }
      });
    return () => { cancelled = true; };
  }, [exportPickerOpen]);

  return { exportFreeBytes };
}
