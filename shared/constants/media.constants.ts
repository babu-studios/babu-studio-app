export const MEDIA_CORE_STATUS_TIMEOUT_MS = 5000;
export const MEDIA_CORE_RECORDING_TIMEOUT_MS = 20000;

export const EXPORT_RESOLUTIONS = {
  "720p": { label: "HD 720p", horizontal: { width: 1280, height: 720 }, vertical: { width: 720, height: 1280 } },
  "1080p": { label: "Full HD 1080p", horizontal: { width: 1920, height: 1080 }, vertical: { width: 1080, height: 1920 } },
  "1440p": { label: "QHD 1440p", horizontal: { width: 2560, height: 1440 }, vertical: { width: 1440, height: 2560 } },
  "2160p": { label: "4K 2160p", horizontal: { width: 3840, height: 2160 }, vertical: { width: 2160, height: 3840 } },
} as const;

export type ExportResolutionId = keyof typeof EXPORT_RESOLUTIONS;
export const DEFAULT_EXPORT_RESOLUTION: ExportResolutionId = "1080p";
