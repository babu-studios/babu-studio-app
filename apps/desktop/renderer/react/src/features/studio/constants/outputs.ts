import type { IconName, OutputId } from "@/features/studio/types/studio.types";

export const OUTPUTS: { id: OutputId; name: string; ratio: string; size: string; width: number; height: number; icon: IconName }[] = [
  { id: "landscape", name: "Landscape", ratio: "16:9", size: "1920 × 1080", width: 1920, height: 1080, icon: "landscape" },
  { id: "portrait", name: "Portrait", ratio: "9:16", size: "1080 × 1920", width: 1080, height: 1920, icon: "portrait" },
];
