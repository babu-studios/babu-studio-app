import { useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import {
  MEDIA_DESTINATIONS,
  publishMediaRequests,
  type MediaDestination,
  type MediaPublishRequest,
} from "./media-publishing";
import type { YouTubeVideoCategory } from "@shared/types/youtube";

const MEDIA_DRAFT_STORAGE_KEY = "babu-studio.media-draft.v1";
const ALL_DESTINATIONS = MEDIA_DESTINATIONS.map(({ id }) => id);

type MediaForm = {
  title: string;
  description: string;
  youtubeCategoryId: string;
  youtubeTags: string[];
  hashtags: string[];
  youtubeVisibility: "PUBLIC" | "UNLISTED" | "PRIVATE";
  youtubeMadeForKids: boolean;
};

type MediaDraft = {
  configurations: Record<MediaDestination, MediaForm>;
  destinations: MediaDestination[];
  warning: string | null;
};

type MediaAsset = {
  file: File;
  url: string;
};

type MediaAssets = {
  horizontal: MediaAsset | null;
  vertical: MediaAsset | null;
  horizontalCover: MediaAsset | null;
  verticalCover: MediaAsset | null;
};

type PublishNotice = {
  tone: "success" | "warning" | "error";
  title: string;
  details: string[];
};

const EMPTY_FORM: MediaForm = {
  title: "",
  description: "",
  youtubeCategoryId: "",
  youtubeTags: [],
  hashtags: [],
  youtubeVisibility: "PUBLIC",
  youtubeMadeForKids: false,
};

function readMediaForm(value: unknown): MediaForm {
  const form = isRecord(value) ? value : {};
  const visibility = form.youtubeVisibility;
  return {
    title: typeof form.title === "string" ? form.title : "",
    description: typeof form.description === "string" ? form.description : "",
    youtubeCategoryId: typeof form.youtubeCategoryId === "string" ? form.youtubeCategoryId : "",
    youtubeTags: Array.isArray(form.youtubeTags)
      ? form.youtubeTags.filter((tag): tag is string => typeof tag === "string")
      : [],
    hashtags: Array.isArray(form.hashtags)
      ? form.hashtags.filter((tag): tag is string => typeof tag === "string")
      : [],
    youtubeVisibility: visibility === "UNLISTED" || visibility === "PRIVATE" ? visibility : "PUBLIC",
    youtubeMadeForKids: form.youtubeMadeForKids === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMediaDraft(): MediaDraft {
  try {
    const saved = localStorage.getItem(MEDIA_DRAFT_STORAGE_KEY);
    if (!saved) {
      return {
        configurations: {
          "youtube-video": EMPTY_FORM,
          "youtube-shorts": EMPTY_FORM,
        },
        destinations: ALL_DESTINATIONS,
        warning: null,
      };
    }

    const value: unknown = JSON.parse(saved);
    if (!isRecord(value)) {
      throw new Error("Saved media draft has an invalid format.");
    }
    const savedConfigurations = isRecord(value.configurations) ? value.configurations : {};
    const legacyForm = readMediaForm(value.form);
    const savedDestinations = Array.isArray(value.destinations)
      ? value.destinations.filter(
        (item): item is MediaDestination =>
          typeof item === "string" && MEDIA_DESTINATIONS.some((target) => target.id === item),
      )
      : ALL_DESTINATIONS;
    return {
      configurations: {
        "youtube-video": readMediaForm(savedConfigurations["youtube-video"] ?? legacyForm),
        "youtube-shorts": readMediaForm(savedConfigurations["youtube-shorts"] ?? legacyForm),
      },
      destinations: savedDestinations,
      warning: null,
    };
  } catch (error) {
    console.error("Unable to load the saved media draft:", error);
    return {
      configurations: {
        "youtube-video": EMPTY_FORM,
        "youtube-shorts": EMPTY_FORM,
      },
      destinations: ALL_DESTINATIONS,
      warning: error instanceof Error
        ? `Saved draft could not be loaded: ${error.message}`
        : "Saved draft could not be loaded.",
    };
  }
}

function TagEditor({
  label,
  hint,
  tags,
  onChange,
  placeholder,
}: {
  label: string;
  hint: string;
  tags: string[];
  onChange: (tags: string[]) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState("");
  const addTags = (input: string) => {
    const additions = input.split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
      .map((tag) => label.toLowerCase().includes("hashtags") && !tag.startsWith("#") ? `#${tag}` : tag);
    if (additions.length > 0) {
      const existing = new Set(tags.map((tag) => tag.toLocaleLowerCase()));
      onChange([...tags, ...additions.filter((tag) => !existing.has(tag.toLocaleLowerCase()))]);
      setValue("");
    }
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addTags(value);
    } else if (event.key === "Backspace" && !value && tags.length > 0) {
      onChange(tags.slice(0, -1));
    }
  };

  return (
    <div className="media-field">
      <label className="media-field-label">{label}</label>
      <div className="media-tag-input">
        {tags.map((tag, index) => (
          <span className="media-tag" key={`${tag}-${index}`}>
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              onClick={() => onChange(tags.filter((_, tagIndex) => tagIndex !== index))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={value}
          aria-label={label}
          placeholder={tags.length === 0 ? placeholder : "Add another"}
          onChange={(event) => {
            if (event.target.value.includes(",")) {
              addTags(event.target.value);
            } else {
              setValue(event.target.value);
            }
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => addTags(value)}
        />
      </div>
      <span className="media-field-hint">{hint}</span>
    </div>
  );
}

function MediaLayoutCard({
  layout,
  video,
  cover,
  disabled,
  error,
  onChooseVideo,
  onChooseCover,
  onRemoveVideo,
  onRemoveCover,
}: {
  layout: "horizontal" | "vertical";
  video: MediaAsset | null;
  cover: MediaAsset | null;
  disabled: boolean;
  error?: string;
  onChooseVideo: (file: File | undefined) => void;
  onChooseCover: (file: File | undefined) => void;
  onRemoveVideo: () => void;
  onRemoveCover: () => void;
}) {
  const videoInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [dragging, setDragging] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  useEffect(() => {
    if (disabled) {
      videoRef.current?.pause();
    }
    setVideoPlaying(false);
    setPreviewError(null);
  }, [disabled, video?.url]);
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (disabled) {
      return;
    }
    const file = event.dataTransfer.files[0];
    if (!file) {
      return;
    }
    if (file.type.startsWith("image/")) {
      onChooseCover(file);
    } else {
      onChooseVideo(file);
    }
  };
  const playVideo = () => {
    const player = videoRef.current;
    if (disabled || !player) {
      return;
    }
    setPreviewError(null);
    void player.play().catch((error: unknown) => {
      setPreviewError(error instanceof Error ? error.message : "Unable to play this video preview.");
    });
  };

  return (
    <section
      className={`media-video-layout media-video-layout--${layout}${disabled ? " media-video-layout--disabled" : ""}`}
      aria-disabled={disabled}
    >
      <input
        ref={videoInputRef}
        className="media-visually-hidden"
        type="file"
        accept="video/*"
        aria-label={`Upload ${layout} video`}
        disabled={disabled}
        onChange={(event) => {
          onChooseVideo(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={coverInputRef}
        className="media-visually-hidden"
        type="file"
        accept="image/*"
        aria-label={`Upload ${layout} thumbnail`}
        disabled={disabled}
        onChange={(event) => {
          onChooseCover(event.currentTarget.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <div className="media-video-layout-heading">
        <div className="media-video-layout-title">
          <strong>{layout === "horizontal" ? "Horizontal" : "Vertical"}</strong>
          <span>{layout === "horizontal" ? "16:9" : "9:16"}</span>
        </div>
        <div className="media-layout-upload-actions">
          <button
            className={`media-layout-upload-button${video ? " media-layout-upload-button--remove" : ""}`}
            type="button"
            disabled={disabled}
            aria-label={video ? `Remove ${layout} video` : `Upload ${layout} video`}
            title={video ? `Remove ${layout} video` : `Choose ${layout} video`}
            onClick={() => video ? onRemoveVideo() : videoInputRef.current?.click()}
          >
            Video{video && <span className="media-layout-remove-icon" aria-hidden="true" />}
          </button>
          <button
            className={`media-layout-upload-button${cover ? " media-layout-upload-button--remove" : ""}`}
            type="button"
            disabled={disabled}
            aria-label={cover ? `Remove ${layout} thumbnail` : `Upload ${layout} thumbnail`}
            title={cover ? `Remove ${layout} thumbnail` : `Choose ${layout} thumbnail`}
            onClick={() => cover ? onRemoveCover() : coverInputRef.current?.click()}
          >
            Thumbnail{cover && <span className="media-layout-remove-icon" aria-hidden="true" />}
          </button>
        </div>
      </div>
      <div
        className={`media-layout-preview media-layout-preview--${layout}${dragging ? " media-layout-preview--dragging" : ""}`}
        onDragOver={(event) => {
          event.preventDefault();
          if (!disabled) {
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        {video ? (
          <>
            <video
              ref={videoRef}
              key={video.url}
              className="media-layout-preview-video"
              src={video.url}
              preload="metadata"
              controls={!disabled && (!cover || videoPlaying)}
              playsInline
              onPlay={() => {
                setVideoPlaying(true);
                setPreviewError(null);
              }}
              onPause={() => setVideoPlaying(false)}
              onEnded={() => setVideoPlaying(false)}
            />
            {cover && !videoPlaying && (
              <button
                className="media-layout-thumbnail"
                type="button"
                disabled={disabled}
                aria-label={`Play ${layout} video preview`}
                onClick={playVideo}
              >
                <img src={cover.url} alt="" />
                <span aria-hidden="true">▶</span>
              </button>
            )}
          </>
        ) : cover ? (
          <img className="media-layout-thumbnail-image" src={cover.url} alt={`${layout} thumbnail preview`} />
        ) : (
          <span className="media-layout-preview-placeholder">Video preview</span>
        )}
      </div>
      {previewError && <span className="media-upload-error" role="alert">{previewError}</span>}
      {error && <span className="media-upload-error">{error}</span>}
    </section>
  );
}

function destinationRequiresVideo(
  destination: MediaDestination,
  assets: MediaAssets,
): boolean {
  if (destination === "youtube-video") {
    return assets.horizontal !== null;
  }
  if (destination === "youtube-shorts") {
    return assets.vertical !== null;
  }
  return false;
}

function YouTubeIcon() {
  return (
    <svg className="media-youtube-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="4.5" width="20" height="15" rx="4.5" fill="#ff0033" />
      <path d="m10 8.5 6 3.5-6 3.5v-7Z" fill="#fff" />
    </svg>
  );
}

export function MediaPage() {
  const [savedDraft] = useState(readMediaDraft);
  const [configurations, setConfigurations] = useState(savedDraft.configurations);
  const [selectedDestinations, setSelectedDestinations] = useState<MediaDestination[]>(savedDraft.destinations);
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [configurationTab, setConfigurationTab] = useState<MediaDestination>(
    savedDraft.destinations[0] ?? MEDIA_DESTINATIONS[0].id,
  );
  const [draftStatus, setDraftStatus] = useState(savedDraft.warning ?? "Changes save automatically");
  const [assets, setAssets] = useState<MediaAssets>({
    horizontal: null,
    vertical: null,
    horizontalCover: null,
    verticalCover: null,
  });
  const assetsRef = useRef(assets);
  const readyDestinations = selectedDestinations.filter((destination) =>
    destinationRequiresVideo(destination, assets));
  const skippedDestinations = selectedDestinations.filter((destination) =>
    !readyDestinations.includes(destination));
  const selectedLayoutsComplete = selectedDestinations.length > 0
    && selectedDestinations.every((destination) => destination === "youtube-video"
      ? assets.horizontal !== null && assets.horizontalCover !== null
      : assets.vertical !== null && assets.verticalCover !== null);
  const [assetError, setAssetError] = useState<string | null>(null);
  const [publishNotice, setPublishNotice] = useState<PublishNotice | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [youtubeOAuthStatus, setYouTubeOAuthStatus] = useState<{ connected: boolean } | null>(null);
  const [connectingYouTube, setConnectingYouTube] = useState(false);
  const [youtubeCategories, setYouTubeCategories] = useState<YouTubeVideoCategory[]>([]);
  const [youtubeCategoriesLoading, setYouTubeCategoriesLoading] = useState(false);
  const [youtubeCategoriesLoaded, setYouTubeCategoriesLoaded] = useState(false);
  const [youtubeOAuthError, setYouTubeOAuthError] = useState<string | null>(null);
  const [youtubeCategoryError, setYouTubeCategoryError] = useState<string | null>(null);

  const activeConfiguration = readyDestinations.includes(configurationTab)
    ? configurationTab
    : readyDestinations[0] ?? selectedDestinations[0] ?? MEDIA_DESTINATIONS[0].id;
  const form = configurations[activeConfiguration];

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        localStorage.setItem(MEDIA_DRAFT_STORAGE_KEY, JSON.stringify({
          configurations,
          destinations: selectedDestinations,
        }));
        setDraftStatus("Draft saved on this device");
      } catch (error) {
        console.error("Unable to save the media draft:", error);
        setDraftStatus(error instanceof Error
          ? `Draft save failed: ${error.message}`
          : "Draft save failed.");
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [configurations, selectedDestinations]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve()
      .then(() => {
        if (typeof window.babuStudio?.getYouTubeOAuthStatus !== "function") {
          throw new Error("Restart Babu Studio to load the updated YouTube integration.");
        }
        return window.babuStudio.getYouTubeOAuthStatus();
      })
      .then((status) => {
        if (!cancelled) {
          setYouTubeOAuthStatus(status);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setYouTubeOAuthStatus({ connected: false });
          setYouTubeOAuthError(`Unable to check secure YouTube OAuth storage: ${error instanceof Error ? error.message : String(error)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (currentStep !== 3 || youtubeOAuthStatus?.connected !== true || youtubeCategoriesLoaded) {
      return;
    }
    let cancelled = false;
    setYouTubeCategoriesLoading(true);
    setYouTubeCategoryError(null);
    void Promise.resolve()
      .then(() => {
        if (typeof window.babuStudio?.getYouTubeVideoCategories !== "function") {
          throw new Error("Restart Babu Studio to load the updated YouTube integration.");
        }
        return window.babuStudio.getYouTubeVideoCategories();
      })
      .then((categories) => {
        if (!cancelled) {
          setYouTubeCategories(categories);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setYouTubeCategoryError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setYouTubeCategoriesLoading(false);
          setYouTubeCategoriesLoaded(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [currentStep, youtubeOAuthStatus?.connected, youtubeCategoriesLoaded]);

  useEffect(() => () => {
    Object.values(assetsRef.current).forEach((asset) => {
      if (asset) {
        URL.revokeObjectURL(asset.url);
      }
    });
  }, []);

  const setFormValue = <K extends keyof MediaForm>(key: K, value: MediaForm[K]) => {
    setConfigurations((current) => ({
      ...current,
      [activeConfiguration]: { ...current[activeConfiguration], [key]: value },
    }));
    setPublishNotice(null);
  };

  const connectYouTubeAccount = async () => {
    setConnectingYouTube(true);
    setYouTubeOAuthError(null);
    try {
      await window.babuStudio.connectYouTubeAccount();
      const status = await window.babuStudio.getYouTubeOAuthStatus();
      setYouTubeOAuthStatus(status);
      setYouTubeCategories([]);
      setYouTubeCategoriesLoaded(false);
    } catch (error) {
      setYouTubeOAuthError(error instanceof Error ? error.message : String(error));
    } finally {
      setConnectingYouTube(false);
    }
  };

  const setAsset = (kind: keyof MediaAssets, file: File | undefined) => {
    if (!file) {
      return;
    }
    const expectedPrefix = kind.endsWith("Cover") ? "image/" : "video/";
    if (!file.type.startsWith(expectedPrefix)) {
      setAssetError(`Choose a ${kind.endsWith("Cover") ? "valid image" : "valid video"} file.`);
      return;
    }
    const url = URL.createObjectURL(file);
    const currentAssets = assetsRef.current;
    const previousAsset = currentAssets[kind];
    if (previousAsset) {
      URL.revokeObjectURL(previousAsset.url);
    }
    const nextAssets = { ...currentAssets, [kind]: { file, url } };
    assetsRef.current = nextAssets;
    setAssets(nextAssets);
    setAssetError(null);
    setPublishNotice(null);
  };

  const removeAsset = (kind: keyof MediaAssets) => {
    const currentAssets = assetsRef.current;
    const removedAsset = currentAssets[kind];
    if (removedAsset) {
      URL.revokeObjectURL(removedAsset.url);
    }
    const nextAssets = { ...currentAssets, [kind]: null };
    assetsRef.current = nextAssets;
    setAssets(nextAssets);
    setPublishNotice(null);
  };

  const toggleDestination = (destination: MediaDestination) => {
    setSelectedDestinations((current) => current.includes(destination)
      ? current.filter((item) => item !== destination)
      : [...current, destination]);
    setPublishNotice(null);
  };

  const continueStep = () => {
    if (currentStep === 1) {
      if (selectedDestinations.length === 0) {
        setPublishNotice({
          tone: "error",
          title: "Choose an upload format",
          details: ["Select YouTube video, Shorts, or both to continue."],
        });
        return;
      }
      setCurrentStep(2);
      setPublishNotice(null);
      return;
    }

    if (!selectedLayoutsComplete) {
      return;
    }
    if (readyDestinations.length === 0) {
      setPublishNotice({
        tone: "error",
        title: "No selected format matches the uploaded layout",
        details: ["Go back to select a format that matches your uploaded video, or add its matching layout."],
      });
      return;
    }

    setConfigurationTab(readyDestinations[0]);
    setCurrentStep(3);
    setPublishNotice(null);
  };

  const publishNow = async () => {
    const errors: string[] = [];
    if (selectedDestinations.length === 0) {
      errors.push("Select at least one YouTube format.");
    }
    if (!assets.horizontal && !assets.vertical) {
      errors.push("Upload a horizontal video, a vertical video, or both.");
    }
    for (const destination of readyDestinations) {
      const configuration = configurations[destination];
      if (!destinationRequiresVideo(destination, assets)) {
        errors.push(`${MEDIA_DESTINATIONS.find((target) => target.id === destination)?.label} needs a matching video file.`);
      }
      if (!configuration.title.trim()) {
        errors.push(`Add a title for ${MEDIA_DESTINATIONS.find((target) => target.id === destination)?.label}.`);
      }
      if (!configuration.youtubeCategoryId) {
        errors.push(`Select a category for ${MEDIA_DESTINATIONS.find((target) => target.id === destination)?.label}.`);
      }
    }
    if (errors.length > 0) {
      setPublishNotice({ tone: "error", title: "Complete the required details", details: [...new Set(errors)] });
      return;
    }
    if (readyDestinations.length === 0) {
      setPublishNotice({
        tone: "error",
        title: "No matching YouTube upload is ready",
        details: ["Select a format that matches an uploaded video layout."],
      });
      return;
    }

    setPublishing(true);
    setPublishNotice(null);
    const requests: MediaPublishRequest[] = readyDestinations.map((destination) => {
      const configuration = configurations[destination];
      return {
        destination,
        horizontalVideo: assets.horizontal?.file ?? null,
        verticalVideo: assets.vertical?.file ?? null,
        coverImage: (destination === "youtube-video" ? assets.horizontalCover : assets.verticalCover)?.file ?? null,
        title: configuration.title.trim(),
        description: configuration.description.trim(),
        youtubeCategoryId: configuration.youtubeCategoryId,
        youtubeTags: configuration.youtubeTags,
        hashtags: configuration.hashtags,
        youtubeVisibility: configuration.youtubeVisibility,
        youtubeMadeForKids: configuration.youtubeMadeForKids,
      };
    });
    const results = await publishMediaRequests(requests);
    setPublishing(false);

    const failures = results.filter((result) => !result.succeeded);
    const completedUploads = results.filter((result) => result.succeeded || result.partialSuccess).length;
    if (failures.length === 0) {
      setPublishNotice({
        tone: "success",
        title: "Published all selected YouTube formats",
        details: results.map((result) =>
          MEDIA_DESTINATIONS.find((target) => target.id === result.destination)?.label ?? result.destination),
      });
    } else {
      const succeeded = completedUploads;
      setPublishNotice({
        tone: succeeded > 0 ? "warning" : "error",
        title: succeeded > 0
          ? "Some YouTube uploads need attention"
          : "Nothing was uploaded",
        details: failures.map((result) => {
          const label = MEDIA_DESTINATIONS.find((target) => target.id === result.destination)?.label ?? result.destination;
          return `${label}: ${result.error ?? "Publishing failed."}`;
        }),
      });
    }
  };

  return (
    <div className="media-page">
      <div className="media-page-inner">
        <header className="media-page-heading">
          <div>
            <span className="media-eyebrow">MEDIA WORKSPACE</span>
            <h1>Publish your media</h1>
            <p>Create, customize, and preview video posts for your selected social platforms.</p>
          </div>
          <div className="media-draft-status" aria-live="polite">
            <span className="media-draft-dot" />
            {draftStatus}
          </div>
        </header>

        <div className="media-workflow-bar">
          <button
            className="media-step-back"
            type="button"
            disabled={currentStep === 1}
            onClick={() => {
              setCurrentStep((step) => (step === 3 ? 2 : 1));
              setPublishNotice(null);
            }}
          >
            <span aria-hidden="true">←</span> Previous
          </button>
          <nav className="media-workflow-steps" aria-label="Publishing steps">
            <div className={`media-workflow-step${currentStep === 1 ? " media-workflow-step--active" : currentStep > 1 ? " media-workflow-step--complete" : ""}`} aria-current={currentStep === 1 ? "step" : undefined}><span>01</span> Select Platform</div>
            <div className="media-workflow-line" />
            <div className={`media-workflow-step${currentStep === 2 ? " media-workflow-step--active" : currentStep > 2 ? " media-workflow-step--complete" : ""}`} aria-current={currentStep === 2 ? "step" : undefined}><span>02</span> Upload Video</div>
            <div className="media-workflow-line" />
            <div className={`media-workflow-step${currentStep === 3 ? " media-workflow-step--active" : ""}`} aria-current={currentStep === 3 ? "step" : undefined}><span>03</span> Configure</div>
          </nav>
          {currentStep < 3 ? (
            <button
              className="media-step-next"
              type="button"
              disabled={
                (currentStep === 1 && selectedDestinations.length === 0)
              || (currentStep === 2 && !selectedLayoutsComplete)
              }
              onClick={continueStep}
            >
              Next <span aria-hidden="true">→</span>
            </button>
          ) : (
            <button
              className="media-step-next media-step-next--publish"
              type="button"
              disabled={publishing}
              aria-busy={publishing}
              onClick={() => void publishNow()}
            >
              {publishing && <span className="media-publish-spinner" aria-hidden="true" />}
              {publishing ? "Publishing…" : "Publish"}
            </button>
          )}
        </div>

        <div className="media-publisher-grid">
          <main className="media-main-column">
            {currentStep === 1 && (
              <section className="media-youtube-connect-card" aria-label="Connect YouTube account">
                <div className="media-youtube-connect-heading">
                  <div>
                    <span className="media-card-kicker">YOUTUBE ACCOUNT</span>
                    <h2>YouTube sign-in</h2>
                    <p>Connect once to load categories and publish your selected formats.</p>
                  </div>
                  {youtubeOAuthStatus === null ? (
                    <span className="media-field-hint">Checking secure account setup…</span>
                  ) : (
                    <div className="media-youtube-account">
                      <span className="media-field-hint">
                        {youtubeOAuthStatus.connected
                          ? "YouTube account connected"
                          : "Sign in to connect your YouTube account"}
                      </span>
                      <div className="media-oauth-actions">
                        <button
                          className="media-oauth-save"
                          type="button"
                          disabled={connectingYouTube}
                          onClick={() => void connectYouTubeAccount()}
                        >
                          {connectingYouTube
                            ? "Connecting…"
                            : youtubeOAuthStatus.connected
                              ? "Reconnect YouTube"
                              : "Sign in with Google"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {youtubeOAuthError && (
                  <div className="media-category-error" role="alert">{youtubeOAuthError}</div>
                )}
              </section>
            )}

            {currentStep === 1 && (
              <section className="media-format-selection" aria-label="Select upload formats">
                <div className="media-platform-select-grid">
                  {MEDIA_DESTINATIONS.map(({ id, label }) => {
                    const selected = selectedDestinations.includes(id);
                    return (
                      <label className={`media-platform-select-option${selected ? " media-platform-select-option--selected" : ""}`} key={id}>
                        <input
                          className="media-visually-hidden"
                          type="checkbox"
                          checked={selected}
                          onChange={() => toggleDestination(id)}
                        />
                        <YouTubeIcon />
                        <span className="media-platform-select-label">
                          <strong>{label}</strong>
                          <small className="media-platform-select-aspect">{id === "youtube-video" ? "16:9" : "9:16"}</small>
                        </span>
                        <span className="media-platform-select-check" aria-hidden="true">{selected ? "✓" : ""}</span>
                      </label>
                    );
                  })}
                </div>
              </section>
            )}

            {currentStep === 2 && <section className="media-video-upload-grid" aria-label="Upload videos">
              <MediaLayoutCard
                layout="horizontal"
                video={assets.horizontal}
                cover={assets.horizontalCover}
                disabled={!selectedDestinations.includes("youtube-video")}
                error={assetError ?? undefined}
                onChooseVideo={(file) => setAsset("horizontal", file)}
                onChooseCover={(file) => setAsset("horizontalCover", file)}
                onRemoveVideo={() => removeAsset("horizontal")}
                onRemoveCover={() => removeAsset("horizontalCover")}
              />
              <MediaLayoutCard
                layout="vertical"
                video={assets.vertical}
                cover={assets.verticalCover}
                disabled={!selectedDestinations.includes("youtube-shorts")}
                error={assetError ?? undefined}
                onChooseVideo={(file) => setAsset("vertical", file)}
                onChooseCover={(file) => setAsset("verticalCover", file)}
                onRemoveVideo={() => removeAsset("vertical")}
                onRemoveCover={() => removeAsset("verticalCover")}
              />
            </section>
            }

            {currentStep === 3 && <section className="media-card">
              {skippedDestinations.length > 0 && (
                <div className="media-publish-notice media-publish-notice--warning" role="status">
                  <strong>Some selected formats will be skipped</strong>
                  <ul>
                    {skippedDestinations.map((destination) => (
                      <li key={destination}>
                        {MEDIA_DESTINATIONS.find((target) => target.id === destination)?.label} has no matching video layout uploaded.
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="media-tabs media-tabs--configuration" role="tablist" aria-label="YouTube format configuration">
                {MEDIA_DESTINATIONS.filter(({ id }) => readyDestinations.includes(id)).map(({ id, label }) => (
                  <button
                    className={`media-tab${activeConfiguration === id ? " media-tab--active" : ""}`}
                    type="button"
                    role="tab"
                    aria-selected={activeConfiguration === id}
                    key={id}
                    onClick={() => {
                      setConfigurationTab(id);
                      setPublishNotice(null);
                    }}
                  >
                    <YouTubeIcon />
                    {label}
                  </button>
                ))}
              </div>

              <div className="media-form-grid">
                <div className="media-field media-field--full">
                  <label className="media-field-label" htmlFor="media-title">Title <span>Required</span></label>
                  <input
                    id="media-title"
                    className="media-text-input"
                    value={form.title}
                    maxLength={100}
                    placeholder="Give your video a clear title"
                    onChange={(event) => setFormValue("title", event.target.value)}
                  />
                  <span className="media-field-hint">{form.title.length}/100 characters</span>
                </div>
                <div className="media-field media-field--full">
                  <label className="media-field-label" htmlFor="media-description">Description</label>
                  <textarea
                    id="media-description"
                    className="media-text-input media-textarea"
                    value={form.description}
                    maxLength={5000}
                    placeholder="Describe your video, add context, links, and credits..."
                    onChange={(event) => setFormValue("description", event.target.value)}
                  />
                  <span className="media-field-hint">{form.description.length}/5,000 characters</span>
                </div>
                <div className="media-field media-field--full">
                  <label className="media-field-label" htmlFor={`${activeConfiguration}-category`}>
                    Category <span>Required</span>
                  </label>
                  <select
                    id={`${activeConfiguration}-category`}
                    className="media-text-input"
                    value={form.youtubeCategoryId}
                    disabled={youtubeOAuthStatus?.connected !== true || youtubeCategoriesLoading || youtubeCategories.length === 0}
                    onChange={(event) => setFormValue("youtubeCategoryId", event.target.value)}
                  >
                    <option value="">
                      {youtubeCategoriesLoading
                        ? "Loading categories from YouTube…"
                        : youtubeOAuthStatus === null
                          ? "Checking YouTube connection…"
                          : youtubeCategories.length > 0
                            ? "Choose a category"
                            : youtubeOAuthStatus.connected
                              ? "Categories unavailable"
                              : "Connect YouTube to load categories"}
                    </option>
                    {youtubeCategories.map((category) => (
                      <option key={category.id} value={category.id}>{category.title}</option>
                    ))}
                  </select>
                  {youtubeCategoriesLoading && (
                    <span className="media-field-hint">Loading categories for India…</span>
                  )}
                  {youtubeCategoryError && (
                    <div className="media-category-error" role="alert">
                      <span>{youtubeCategoryError}</span>
                      {youtubeOAuthStatus?.connected && (
                        <button
                          className="media-category-action"
                          type="button"
                          onClick={() => {
                            setYouTubeCategoryError(null);
                            setYouTubeCategoriesLoaded(false);
                          }}
                        >
                          Retry
                        </button>
                      )}
                    </div>
                  )}
                  {youtubeOAuthStatus?.connected !== true && (
                    <div className="media-youtube-connect-hint">
                      <span>Connect YouTube from Select Platform to load categories.</span>
                      <button
                        className="media-category-action"
                        type="button"
                        onClick={() => setCurrentStep(1)}
                      >
                        Go to Select Platform
                      </button>
                    </div>
                  )}
                </div>
                <TagEditor
                  label="YouTube tags"
                  hint="Press Enter or comma after each tag."
                  tags={form.youtubeTags}
                  placeholder="Add search tags"
                  onChange={(tags) => setFormValue("youtubeTags", tags)}
                />
                <TagEditor
                  label="YouTube hashtags"
                  hint="Hashtags can be included in your video title or description."
                  tags={form.hashtags}
                  placeholder="Add YouTube hashtags"
                  onChange={(hashtags) => setFormValue("hashtags", hashtags)}
                />
              </div>
              <div className="media-config-settings">
                <div className="media-field">
                  <label className="media-field-label" htmlFor={`${activeConfiguration}-visibility`}>Visibility</label>
                  <select
                    id={`${activeConfiguration}-visibility`}
                    className="media-text-input"
                    value={form.youtubeVisibility}
                    onChange={(event) => setFormValue("youtubeVisibility", event.target.value as MediaForm["youtubeVisibility"])}
                  >
                    <option value="PUBLIC">Public</option>
                    <option value="UNLISTED">Unlisted</option>
                    <option value="PRIVATE">Private</option>
                  </select>
                </div>
                <label className="media-checkbox-row">
                  <input
                    type="checkbox"
                    checked={form.youtubeMadeForKids}
                    onChange={(event) => setFormValue("youtubeMadeForKids", event.target.checked)}
                  />
                  <span>Made for kids</span>
                  <small>Audience setting required by YouTube</small>
                </label>
              </div>
            </section>
            }

            {publishNotice && (
              <div className={`media-publish-notice media-publish-notice--${publishNotice.tone}`} role={publishNotice.tone === "error" ? "alert" : "status"}>
                <strong>{publishNotice.title}</strong>
                <ul>
                  {publishNotice.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}
                </ul>
              </div>
            )}
          </main>

        </div>
      </div>
    </div>
  );
}
