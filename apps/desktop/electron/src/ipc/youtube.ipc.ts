import { ipcMain } from "electron";
import type { YouTubeVideoUploadMetadata } from "@shared/types/youtube";
import { YouTubeApiService } from "../services/youtube-api.service";

function isVideoUploadMetadata(value: unknown): value is YouTubeVideoUploadMetadata {
  return typeof value === "object"
    && value !== null
    && "title" in value
    && typeof value.title === "string"
    && "description" in value
    && typeof value.description === "string"
    && "categoryId" in value
    && typeof value.categoryId === "string"
    && "tags" in value
    && Array.isArray(value.tags)
    && value.tags.every((tag: unknown) => typeof tag === "string")
    && "privacyStatus" in value
    && (value.privacyStatus === "PUBLIC" || value.privacyStatus === "UNLISTED" || value.privacyStatus === "PRIVATE")
    && "madeForKids" in value
    && typeof value.madeForKids === "boolean"
    && "mimeType" in value
    && typeof value.mimeType === "string"
    && "totalBytes" in value
    && typeof value.totalBytes === "number";
}

export function registerYouTubeIpc(service: YouTubeApiService): void {
  ipcMain.handle("youtube:get-oauth-status", () => service.getOAuthStatus());
  ipcMain.handle("youtube:connect-account", () => service.connectAccount());
  ipcMain.handle("youtube:video-categories", () => service.getVideoCategories());
  ipcMain.handle("youtube:begin-video-upload", (_event, value: unknown) => {
    if (!isVideoUploadMetadata(value)) {
      throw new Error("Video upload metadata is invalid.");
    }
    return service.beginVideoUpload(value);
  });
  ipcMain.handle(
    "youtube:upload-video-chunk",
    (_event, uploadId: unknown, offset: unknown, bytes: unknown, totalBytes: unknown) => {
      if (
        typeof uploadId !== "string"
        || typeof offset !== "number"
        || !(bytes instanceof Uint8Array)
        || typeof totalBytes !== "number"
      ) {
        throw new Error("Video upload chunk is invalid.");
      }
      return service.uploadVideoChunk(uploadId, offset, bytes, totalBytes);
    },
  );
  ipcMain.handle(
    "youtube:upload-thumbnail",
    (_event, videoId: unknown, mimeType: unknown, bytes: unknown) => {
      if (typeof videoId !== "string" || typeof mimeType !== "string" || !(bytes instanceof Uint8Array)) {
        throw new Error("Thumbnail upload data is invalid.");
      }
      return service.uploadThumbnail(videoId, mimeType, bytes);
    },
  );
}
