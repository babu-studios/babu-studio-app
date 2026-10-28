import { useEffect, useState } from "react";

export function useAiSourceFiles(args: {
  selectedRecordingId: string;
  onRestoreShotExport: (shotPath: string) => void;
}) {
  const { selectedRecordingId, onRestoreShotExport } = args;
  const [aiSourceFiles, setAiSourceFiles] = useState<string[]>([]);
  const [selectedAiSourceFile, setSelectedAiSourceFile] = useState<string | null>(null);

  useEffect(() => {
    setAiSourceFiles([]);
    setSelectedAiSourceFile(null);
  }, [selectedRecordingId]);

  function markShotExported(): void {
    setSelectedAiSourceFile("ai-360p.mp4");
    setAiSourceFiles((current) => (current.includes("ai-360p.mp4") ? current : ["ai-360p.mp4", ...current]));
  }

  async function refreshAiShotPath(): Promise<void> {
    if (!selectedRecordingId) {
      return;
    }
    try {
      const artifacts = await window.babuStudio.getAiArtifacts({ id: selectedRecordingId });
      setAiSourceFiles(artifacts.shotFiles);
      setSelectedAiSourceFile((current) => {
        if (current && artifacts.shotFiles.includes(current)) {
          return current;
        }
        return artifacts.shotFiles[0] ?? null;
      });
      if (artifacts.shotPath) {
        onRestoreShotExport(artifacts.shotPath);
      }
    } catch {
      // Keep the current in-memory state when the take cannot be read.
    }
  }

  return {
    aiSourceFiles,
    selectedAiSourceFile,
    setSelectedAiSourceFile,
    refreshAiShotPath,
    markShotExported,
  };
}
