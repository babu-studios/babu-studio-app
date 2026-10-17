import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { app, net, safeStorage, shell } from "electron";
import type {
  YouTubeOAuthStatus,
  YouTubeVideoCategory,
  YouTubeVideoUploadChunkResult,
  YouTubeVideoUploadMetadata,
} from "@shared/types/youtube";

declare const __YOUTUBE_OAUTH_CLIENT_SECRET__: string;

const YOUTUBE_REGION_CODE = "IN";
const YOUTUBE_OAUTH_CLIENT_ID = "201580552974-n66lasru63bmmm1lhjpammi825f98sru.apps.googleusercontent.com";
const OAUTH_SCOPE = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
].join(" ");
const VIDEO_CHUNK_LIMIT = 8 * 1024 * 1024;
const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024;
const OAUTH_CREDENTIALS_FILE_NAME = "youtube-oauth.enc";

type StoredYouTubeTokens = {
  refreshToken: string | null;
  accessToken: string | null;
  accessTokenExpiresAt: number;
};

type ActiveVideoUpload = {
  uploadUrl: string;
  totalBytes: number;
  mimeType: string;
  nextOffset: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJsonResponse(response: Response): Promise<unknown> {
  const body = await response.text();
  if (!body) {
    return null;
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("Google returned an unreadable response.");
  }
}

function responseError(payload: unknown): string {
  if (isRecord(payload)) {
    if (typeof payload.error_description === "string") {
      return typeof payload.error === "string"
        ? `${payload.error}: ${payload.error_description}`
        : payload.error_description;
    }
    const apiError = payload.error;
    if (typeof apiError === "string") {
      return apiError;
    }
    if (isRecord(apiError)) {
      if (typeof apiError.message === "string") {
        return apiError.message;
      }
      if (typeof apiError.status === "string") {
        return apiError.status;
      }
    }
  }
  return "request failed";
}

export class YouTubeApiService {
  private readonly uploadSessions = new Map<string, ActiveVideoUpload>();

  getOAuthStatus(): YouTubeOAuthStatus {
    const tokens = this.readTokens();
    return {
      connected: Boolean(tokens?.refreshToken),
    };
  }

  async connectAccount(): Promise<void> {
    const clientSecret = __YOUTUBE_OAUTH_CLIENT_SECRET__.trim();
    if (!clientSecret) {
      throw new Error("Google sign-in is not configured in this build. Add BABU_STUDIO_YOUTUBE_CLIENT_SECRET to the local Electron .env.local file and rebuild.");
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable for YouTube authorization tokens.");
    }
    const existingTokens = this.readTokens() ?? {
      refreshToken: null,
      accessToken: null,
      accessTokenExpiresAt: 0,
    };
    const codeVerifier = randomBytes(32).toString("base64url");
    const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
    const state = randomBytes(32).toString("base64url");
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(0, "127.0.0.1", () => {
        server.removeListener("error", onError);
        resolve();
      });
    });

    const address = server.address();
    if (!address || typeof address === "string") {
      server.close();
      throw new Error("Unable to open a local OAuth callback.");
    }
    const redirectUri = `http://127.0.0.1:${address.port}`;
    const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authorizationUrl.searchParams.set("client_id", YOUTUBE_OAUTH_CLIENT_ID);
    authorizationUrl.searchParams.set("redirect_uri", redirectUri);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("scope", OAUTH_SCOPE);
    authorizationUrl.searchParams.set("access_type", "offline");
    authorizationUrl.searchParams.set("prompt", "select_account consent");
    authorizationUrl.searchParams.set("state", state);
    authorizationUrl.searchParams.set("code_challenge", codeChallenge);
    authorizationUrl.searchParams.set("code_challenge_method", "S256");

    let timeout: NodeJS.Timeout | undefined;
    const codePromise = new Promise<string>((resolve, reject) => {
      let settled = false;
      const finish = (error: Error | null, code?: string) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        if (error) {
          reject(error);
        } else if (code) {
          resolve(code);
        } else {
          reject(new Error("Google did not return an authorization code."));
        }
      };

      timeout = setTimeout(() => finish(new Error("YouTube sign-in timed out. Try connecting again.")), 5 * 60 * 1000);
      server.on("request", (request, response) => {
        if (request.method !== "GET" || !request.url) {
          response.writeHead(404).end();
          return;
        }
        const callbackUrl = new URL(request.url, redirectUri);
        if (callbackUrl.pathname !== "/") {
          response.writeHead(404).end();
          return;
        }
        if (callbackUrl.searchParams.get("state") !== state) {
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Invalid OAuth state.");
          return;
        }
        const oauthError = callbackUrl.searchParams.get("error");
        if (oauthError) {
          response.writeHead(400, { "Content-Type": "text/html; charset=utf-8" })
            .end("<p>YouTube sign-in was not completed. Return to Babu Studio.</p>");
          finish(new Error(`YouTube sign-in was not completed: ${oauthError}.`));
          return;
        }
        const code = callbackUrl.searchParams.get("code");
        if (!code) {
          response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" }).end("Google did not return an authorization code.");
          finish(new Error("Google did not return an authorization code."));
          return;
        }
        response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" })
          .end("<!doctype html><title>Babu Studio</title><p>YouTube is connected. You can return to Babu Studio.</p>");
        finish(null, code);
      });
    });

    try {
      await shell.openExternal(authorizationUrl.toString());
      const code = await codePromise;
      const tokenResponse = await net.fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: YOUTUBE_OAUTH_CLIENT_ID,
          client_secret: clientSecret,
          code,
          code_verifier: codeVerifier,
          grant_type: "authorization_code",
          redirect_uri: redirectUri,
        }).toString(),
      });
      const payload = await readJsonResponse(tokenResponse);
      if (!tokenResponse.ok) {
        throw new Error(`YouTube sign-in failed (${tokenResponse.status}): ${responseError(payload)}.`);
      }
      if (!isRecord(payload) || typeof payload.access_token !== "string") {
        throw new Error("Google returned an invalid OAuth token response.");
      }
      const refreshToken = typeof payload.refresh_token === "string"
        ? payload.refresh_token
        : existingTokens.refreshToken;
      if (!refreshToken) {
        throw new Error("Google did not return a refresh token. Reconnect and approve offline access.");
      }
      const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
      this.writeTokens({
        ...existingTokens,
        refreshToken,
        accessToken: payload.access_token,
        accessTokenExpiresAt: Date.now() + expiresIn * 1000 - 60_000,
      });
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      server.close();
    }
  }

  async getVideoCategories(): Promise<YouTubeVideoCategory[]> {
    const url = new URL("https://www.googleapis.com/youtube/v3/videoCategories");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("regionCode", YOUTUBE_REGION_CODE);
    const response = await this.authenticatedFetch(url.toString(), { method: "GET", headers: {} });
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`YouTube category request failed (${response.status}): ${responseError(payload)}.`);
    }
    if (!isRecord(payload) || !Array.isArray(payload.items)) {
      throw new Error("YouTube returned an invalid video category list.");
    }
    const categories = payload.items.flatMap((item): YouTubeVideoCategory[] => {
      if (!isRecord(item) || typeof item.id !== "string" || !isRecord(item.snippet)) {
        return [];
      }
      if (item.snippet.assignable === false || typeof item.snippet.title !== "string") {
        return [];
      }
      return [{ id: item.id, title: item.snippet.title }];
    });
    if (categories.length === 0) {
      throw new Error(`YouTube returned no assignable categories for region ${YOUTUBE_REGION_CODE}.`);
    }
    return categories;
  }

  async beginVideoUpload(metadata: YouTubeVideoUploadMetadata): Promise<string> {
    if (!metadata.title.trim() || !metadata.categoryId || !metadata.mimeType.startsWith("video/")) {
      throw new Error("A video title, category, and valid video file are required.");
    }
    if (!Number.isSafeInteger(metadata.totalBytes) || metadata.totalBytes <= 0) {
      throw new Error("The selected video file has an invalid size.");
    }
    const url = new URL("https://www.googleapis.com/upload/youtube/v3/videos");
    url.searchParams.set("uploadType", "resumable");
    url.searchParams.set("part", "snippet,status");
    const response = await this.authenticatedFetch(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Length": String(metadata.totalBytes),
        "X-Upload-Content-Type": metadata.mimeType,
      },
      body: JSON.stringify({
        snippet: {
          title: metadata.title,
          description: metadata.description,
          categoryId: metadata.categoryId,
          tags: metadata.tags,
        },
        status: {
          privacyStatus: metadata.privacyStatus.toLowerCase(),
          selfDeclaredMadeForKids: metadata.madeForKids,
        },
      }),
    });
    const uploadUrl = response.headers.get("Location");
    if (!response.ok || !uploadUrl) {
      const payload = await readJsonResponse(response);
      throw new Error(`YouTube video upload could not start (${response.status}): ${responseError(payload)}.`);
    }
    const uploadId = randomUUID();
    this.uploadSessions.set(uploadId, {
      uploadUrl,
      totalBytes: metadata.totalBytes,
      mimeType: metadata.mimeType,
      nextOffset: 0,
    });
    return uploadId;
  }

  async uploadVideoChunk(
    uploadId: string,
    offset: number,
    bytes: Uint8Array,
    totalBytes: number,
  ): Promise<YouTubeVideoUploadChunkResult> {
    const upload = this.uploadSessions.get(uploadId);
    if (!upload) {
      throw new Error("The YouTube upload session has expired. Start the upload again.");
    }
    if (
      offset !== upload.nextOffset
      || totalBytes !== upload.totalBytes
      || bytes.byteLength === 0
      || bytes.byteLength > VIDEO_CHUNK_LIMIT
      || offset + bytes.byteLength > totalBytes
    ) {
      throw new Error("The video upload chunk has an invalid size or position.");
    }
    const end = offset + bytes.byteLength - 1;
    const response = await this.authenticatedFetch(upload.uploadUrl, {
      method: "PUT",
      headers: {
        "Content-Type": upload.mimeType,
        "Content-Range": `bytes ${offset}-${end}/${totalBytes}`,
      },
      body: Buffer.from(bytes),
    });
    if (response.status === 308) {
      const range = response.headers.get("Range");
      const uploadedBytes = range
        ? Number.parseInt(range.slice(range.lastIndexOf("-") + 1), 10) + 1
        : end + 1;
      if (
        !Number.isSafeInteger(uploadedBytes)
        || uploadedBytes <= offset
        || uploadedBytes > end + 1
        || uploadedBytes > totalBytes
      ) {
        throw new Error("YouTube returned an invalid resumable upload position.");
      }
      upload.nextOffset = uploadedBytes;
      return { complete: false, uploadedBytes };
    }
    const payload = await readJsonResponse(response);
    if (!response.ok) {
      this.uploadSessions.delete(uploadId);
      throw new Error(`YouTube video upload failed (${response.status}): ${responseError(payload)}.`);
    }
    if (!isRecord(payload) || typeof payload.id !== "string") {
      this.uploadSessions.delete(uploadId);
      throw new Error("YouTube completed the upload without returning a video ID.");
    }
    this.uploadSessions.delete(uploadId);
    return { complete: true, uploadedBytes: totalBytes, videoId: payload.id };
  }

  async uploadThumbnail(videoId: string, mimeType: string, bytes: Uint8Array): Promise<void> {
    const allowedMimeTypes = new Set(["image/jpeg", "image/png", "image/gif", "image/bmp"]);
    if (!videoId || !allowedMimeTypes.has(mimeType) || bytes.byteLength === 0 || bytes.byteLength > MAX_THUMBNAIL_BYTES) {
      throw new Error("YouTube thumbnails must be a supported image type and no larger than 2 MB.");
    }
    const url = new URL("https://www.googleapis.com/upload/youtube/v3/thumbnails/set");
    url.searchParams.set("videoId", videoId);
    url.searchParams.set("uploadType", "media");
    const response = await this.authenticatedFetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": mimeType },
      body: Buffer.from(bytes),
    });
    if (!response.ok) {
      const payload = await readJsonResponse(response);
      throw new Error(`YouTube thumbnail upload failed (${response.status}): ${responseError(payload)}.`);
    }
  }

  private credentialsPath(): string {
    return join(app.getPath("userData"), OAUTH_CREDENTIALS_FILE_NAME);
  }

  private readTokens(): StoredYouTubeTokens | null {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable for YouTube authorization tokens.");
    }
    const path = this.credentialsPath();
    if (!existsSync(path)) {
      return null;
    }
    let value: unknown;
    try {
      value = JSON.parse(safeStorage.decryptString(readFileSync(path))) as unknown;
    } catch {
      throw new Error("Saved YouTube authorization could not be decrypted. Sign in again to continue.");
    }
    if (
      !isRecord(value)
      || !(typeof value.refreshToken === "string" || value.refreshToken === null)
      || !(typeof value.accessToken === "string" || value.accessToken === null)
      || typeof value.accessTokenExpiresAt !== "number"
    ) {
      throw new Error("Saved YouTube authorization has an invalid format. Sign in again to continue.");
    }
    const tokens = {
      refreshToken: value.refreshToken,
      accessToken: value.accessToken,
      accessTokenExpiresAt: value.accessTokenExpiresAt,
    };
    if ("clientId" in value || "clientSecret" in value) {
      this.writeTokens(tokens);
    }
    return tokens;
  }

  private requireTokens(): StoredYouTubeTokens {
    const tokens = this.readTokens();
    if (!tokens) {
      throw new Error("Sign in with Google before loading categories or publishing.");
    }
    return tokens;
  }

  private writeTokens(tokens: StoredYouTubeTokens): void {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Secure storage is unavailable, so YouTube authorization tokens cannot be saved.");
    }
    writeFileSync(
      this.credentialsPath(),
      safeStorage.encryptString(JSON.stringify(tokens)),
      { mode: 0o600 },
    );
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    const tokens = this.requireTokens();
    if (
      !forceRefresh
      && tokens.accessToken
      && tokens.accessTokenExpiresAt > Date.now()
    ) {
      return tokens.accessToken;
    }
    if (!tokens.refreshToken) {
      throw new Error("Sign in with Google before loading categories or publishing.");
    }
    const tokenResponse = await net.fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: YOUTUBE_OAUTH_CLIENT_ID,
        client_secret: __YOUTUBE_OAUTH_CLIENT_SECRET__.trim(),
        refresh_token: tokens.refreshToken,
        grant_type: "refresh_token",
      }).toString(),
    });
    const payload = await readJsonResponse(tokenResponse);
    if (!tokenResponse.ok) {
      throw new Error(`YouTube authorization refresh failed (${tokenResponse.status}): ${responseError(payload)}.`);
    }
    if (!isRecord(payload) || typeof payload.access_token !== "string") {
      throw new Error("Google returned an invalid refreshed OAuth token.");
    }
    const expiresIn = typeof payload.expires_in === "number" ? payload.expires_in : 3600;
    this.writeTokens({
      ...tokens,
      accessToken: payload.access_token,
      accessTokenExpiresAt: Date.now() + expiresIn * 1000 - 60_000,
    });
    return payload.access_token;
  }

  private async authenticatedFetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string | Buffer },
  ): Promise<Response> {
    const send = async (token: string) => net.fetch(url, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${token}` },
    });
    let response = await send(await this.getAccessToken());
    if (response.status === 401) {
      response = await send(await this.getAccessToken(true));
    }
    return response;
  }
}
