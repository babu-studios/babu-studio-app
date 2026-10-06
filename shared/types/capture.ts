export type DesktopCaptureSource = {
  id: string;
  name: string;
};

export type ScreenCapturePermissionStatus =
  | "not-determined"
  | "granted"
  | "denied"
  | "restricted"
  | "unknown";

export type DesktopCaptureSourcesResult = {
  sources: DesktopCaptureSource[];
  permissionStatus: ScreenCapturePermissionStatus;
  error: string | null;
};
