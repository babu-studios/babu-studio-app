export function Brand() {
  return (
    <div className="brand">
      <svg className="brand-logo" viewBox="100 100 824 824" aria-hidden="true">
        <defs>
          <linearGradient id="brand-logo-bg" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#262d2a" />
            <stop offset="1" stopColor="#101412" />
          </linearGradient>
          <radialGradient id="brand-logo-dot" cx="0.4" cy="0.35" r="0.8">
            <stop offset="0" stopColor="#ff7a7a" />
            <stop offset="1" stopColor="#e5304a" />
          </radialGradient>
        </defs>
        <rect x="100" y="100" width="824" height="824" rx="185" fill="url(#brand-logo-bg)" />
        <g fill="none" stroke="#91e5c5" strokeWidth="44" strokeLinecap="round">
          <path d="M345 345 A237 237 0 0 0 345 679" />
          <path d="M679 345 A237 237 0 0 1 679 679" />
          <path d="M262 262 A355 355 0 0 0 262 762" opacity="0.45" />
          <path d="M762 262 A355 355 0 0 1 762 762" opacity="0.45" />
        </g>
        <circle cx="512" cy="512" r="128" fill="url(#brand-logo-dot)" />
      </svg>
      <div className="brand-text">
        <span className="brand-name">Babu Studio</span>
        <span className="brand-credit">
          <svg
            className="brand-credit-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M7 7h10a4.5 4.5 0 0 1 4.4 5.4l-.8 4A2.6 2.6 0 0 1 15.9 17l-1.2-1.6H9.3L8.1 17a2.6 2.6 0 0 1-4.7-.6l-.8-4A4.5 4.5 0 0 1 7 7z" />
            <path d="M8 10v3M6.5 11.5h3" />
            <circle cx="15.5" cy="10.6" r=".6" fill="currentColor" />
            <circle cx="17.5" cy="12.6" r=".6" fill="currentColor" />
          </svg>
          developed by{" "}
          <a
            className="brand-credit-link"
            href="https://www.instagram.com/b4babugaming/"
            target="_blank"
            rel="noreferrer"
          >
            @b4babugaming
          </a>
        </span>
              </div>
    </div>
  );
}
