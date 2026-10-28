import type { ReactNode } from "react";
import type { IconName } from "@/features/studio/types/studio.types";

export function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  const drawings: Record<IconName, ReactNode> = {
    record: <circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" />,
    stream: (
      <>
        <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
        <path d="M7.8 7.8a6 6 0 0 0 0 8.4M16.2 7.8a6 6 0 0 1 0 8.4M4.9 4.9a10 10 0 0 0 0 14.2M19.1 4.9a10 10 0 0 1 0 14.2" />
      </>
    ),
    settings: (
      <>
        <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    landscape: <rect x="3.5" y="5.5" width="17" height="13" rx="2" />,
    portrait: <rect x="7" y="3" width="10" height="18" rx="2" />,
    layers: (
      <>
        <path d="m12 3 9 5-9 5-9-5 9-5Z" />
        <path d="m3 12 9 5 9-5M3 16l9 5 9-5" />
      </>
    ),
    scenes: (
      <>
        <rect x="3.5" y="4.5" width="17" height="6" rx="1.5" />
        <rect x="3.5" y="13.5" width="17" height="6" rx="1.5" />
      </>
    ),
    audio: (
      <>
        <path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 10v4" />
      </>
    ),
    gameplay: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m8 10 3 2-3 2M13.5 14H17" />
      </>
    ),
    camera: (
      <>
        <rect x="3" y="6" width="13" height="12" rx="2" />
        <path d="m16 10 5-3v10l-5-3" />
      </>
    ),
    alerts: (
      <>
        <path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4" />
      </>
    ),
    speaker: (
      <>
        <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
        <path d="M17 9a5 5 0 0 1 0 6M19.5 6.5a9 9 0 0 1 0 11" />
      </>
    ),
    reload: (
      <>
        <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
        <path d="M21 3v5h-5" />
      </>
    ),
    eye: (
      <>
        <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
    "eye-off": (
      <>
        <path d="M9.9 5.2A9.8 9.8 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.9 3.8M6.6 6.6C3.7 8.4 2 12 2 12s3.6 7 10 7c1.6 0 3-.4 4.3-1" />
        <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" />
      </>
    ),
    "speaker-muted": (
      <>
        <path d="M4 10v4h4l5 4V6l-5 4H4Z" />
        <path d="M17 9.5l5 5M22 9.5l-5 5" />
      </>
    ),
    trash: (
      <>
        <path d="M3.5 6h17M9 6V4h6v2M6 6l1 14h10l1-14M10 10v6M14 10v6" />
      </>
    ),
    export: (
      <>
        <path d="M12 15V3m-5 5 5-5 5 5" />
        <path d="M5 13v7h14v-7" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    close: <path d="M6 6l12 12M18 6L6 18" />,
    "chevron-down": <path d="M6 9l6 6 6-6" />,
    "chevron-left": <path d="M15 6l-6 6 6 6" />,
    "chevron-right": <path d="M9 6l6 6-6 6" />,
    check: <path d="M4 12l5 5L20 7" />,
    play: <path d="M8 5v14l11-7z" />,
    pause: <path d="M6 5h4v14H6zM14 5h4v14h-4z" />,
    sparkle: (
      <>
        <path d="M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4L12 3Z" />
        <path d="M18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" />
      </>
    ),
  };

  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {drawings[name]}
    </svg>
  );
}

