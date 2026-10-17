export type YouTubeVideoCategory = {
  id: string;
  title: string;
};

export type YouTubeOAuthStatus = {
  connected: boolean;
};

export type YouTubeVideoUploadMetadata = {
  title: string;
  description: string;
  categoryId: string;
  tags: string[];
  privacyStatus: "PUBLIC" | "UNLISTED" | "PRIVATE";
  madeForKids: boolean;
  mimeType: string;
  totalBytes: number;
};

export type YouTubeVideoUploadChunkResult = {
  complete: boolean;
  uploadedBytes: number;
  videoId?: string;
};
