const VIDEO_UPLOAD_CHUNK_SIZE = 8 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;

export const MEDIA_DESTINATIONS = [
  { id: "youtube-video", label: "YouTube Video", platform: "YouTube" },
  { id: "youtube-shorts", label: "YouTube Shorts", platform: "YouTube" },
] as const;

export type MediaDestination = (typeof MEDIA_DESTINATIONS)[number]["id"];

export type MediaPublishRequest = {
  destination: MediaDestination;
  horizontalVideo: File | null;
  verticalVideo: File | null;
  coverImage: File | null;
  title: string;
  description: string;
  youtubeCategoryId: string;
  youtubeTags: string[];
  hashtags: string[];
  youtubeVisibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  youtubeMadeForKids: boolean;
};

export type MediaPublishResult = {
  destination: MediaDestination;
  succeeded: boolean;
  error?: string;
  partialSuccess?: boolean;
  videoId?: string;
};

export class MediaPublishError extends Error {
  constructor(
    message: string,
    readonly partialSuccess = false,
    readonly videoId?: string,
  ) {
    super(message);
    this.name = "MediaPublishError";
  }
}

export type MediaPublisherAdapter = {
  publish: (request: MediaPublishRequest) => Promise<void>;
};

const publisherAdapters: Partial<Record<MediaDestination, MediaPublisherAdapter>> = {};

const youtubePublisher: MediaPublisherAdapter = {
  async publish(request) {
    const video = request.destination === "youtube-video"
      ? request.horizontalVideo
      : request.verticalVideo;
    if (!video) {
      throw new Error("The video file for this YouTube format is missing.");
    }
    if (!request.coverImage) {
      throw new Error("Upload a thumbnail before publishing this YouTube format.");
    }
    if (request.coverImage.size > MAX_THUMBNAIL_BYTES) {
      throw new Error("YouTube thumbnails must be no larger than 2 MB.");
    }
    if (!["image/jpeg", "image/png", "image/gif", "image/bmp"].includes(request.coverImage.type)) {
      throw new Error("Use a JPEG, PNG, GIF, or BMP image for the YouTube thumbnail.");
    }

    const description = [
      request.description.trim(),
      request.hashtags.map((tag) => tag.startsWith("#") ? tag : `#${tag}`).join(" "),
    ].filter(Boolean).join("\n\n");
    const uploadId = await window.babuStudio.beginYouTubeVideoUpload({
      title: request.title,
      description,
      categoryId: request.youtubeCategoryId,
      tags: request.youtubeTags,
      privacyStatus: request.youtubeVisibility,
      madeForKids: request.youtubeMadeForKids,
      mimeType: video.type || "video/mp4",
      totalBytes: video.size,
    });

    let uploadedBytes = 0;
    let videoId: string | undefined;
    while (uploadedBytes < video.size) {
      const end = Math.min(uploadedBytes + VIDEO_UPLOAD_CHUNK_SIZE, video.size);
      const bytes = new Uint8Array(await video.slice(uploadedBytes, end).arrayBuffer());
      const result = await window.babuStudio.uploadYouTubeVideoChunk(
        uploadId,
        uploadedBytes,
        bytes,
        video.size,
      );
      uploadedBytes = result.uploadedBytes;
      if (result.complete) {
        videoId = result.videoId;
        break;
      }
    }

    if (!videoId) {
      throw new Error("YouTube did not confirm that the video upload completed.");
    }
    try {
      await window.babuStudio.uploadYouTubeThumbnail(
        videoId,
        request.coverImage.type,
        new Uint8Array(await request.coverImage.arrayBuffer()),
      );
    } catch (error) {
      throw new MediaPublishError(
        `Video uploaded successfully (YouTube video ID: ${videoId}), but the thumbnail upload failed: ${error instanceof Error ? error.message : String(error)}`,
        true,
        videoId,
      );
    }
  },
};

publisherAdapters["youtube-video"] = youtubePublisher;
publisherAdapters["youtube-shorts"] = youtubePublisher;

export function registerMediaPublisherAdapter(
  destination: MediaDestination,
  adapter: MediaPublisherAdapter,
): void {
  publisherAdapters[destination] = adapter;
}

export function isMediaPublisherConfigured(destination: MediaDestination): boolean {
  return publisherAdapters[destination] !== undefined;
}

export async function publishMediaRequests(
  requests: MediaPublishRequest[],
): Promise<MediaPublishResult[]> {
  return Promise.all(requests.map(async (request) => {
    const adapter = publisherAdapters[request.destination];
    if (!adapter) {
      return {
        destination: request.destination,
        succeeded: false,
        error: `No ${request.destination} publishing integration is configured.`,
      };
    }
    try {
      await adapter.publish(request);
      return { destination: request.destination, succeeded: true };
    } catch (error) {
      const partialError = error instanceof MediaPublishError && error.partialSuccess;
      return {
        destination: request.destination,
        succeeded: false,
        error: error instanceof Error ? error.message : String(error),
        partialSuccess: partialError || undefined,
        videoId: partialError && error instanceof MediaPublishError ? error.videoId : undefined,
      };
    }
  }));
}
