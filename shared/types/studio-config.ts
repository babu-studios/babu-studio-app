import type { ExportResolutionId } from "../constants/media.constants";
import type { RecordingMode } from "./media";

export type StudioConfiguration = {
  version: 1;
  studio: Record<string, unknown>;
  audioMixer: Record<string, unknown>;
  exportSettings: {
    modes: RecordingMode[];
    resolution: ExportResolutionId;
  };
  preview: {
    landscape: boolean;
    portrait: boolean;
  };
};
