export function Brand() {
  return (
    <div className="brand">
      <svg className="brand-logo" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="16" cy="12" r="4.6" />
        <path d="M9.6 12.5a6.4 6.4 0 0 1 12.8 0" />
        <rect x="7.6" y="11.6" width="3" height="5.2" rx="1.3" fill="currentColor" />
        <rect x="21.4" y="11.6" width="3" height="5.2" rx="1.3" fill="currentColor" />
        <path d="M6 30c.4-4.6 4.2-7.4 10-7.4S25.6 25.4 26 30" />
        <path d="M11.2 24.8h9.6a2.4 2.4 0 0 1 2.3 3l-.3 1.2a1.4 1.4 0 0 1-2.5.4l-.8-1.2h-6l-.8 1.2a1.4 1.4 0 0 1-2.5-.4l-.3-1.2a2.4 2.4 0 0 1 2.3-3z" fill="#17191d" />
        <path d="M12.4 26.4v1.8M11.5 27.3h1.8" />
        <circle cx="19.4" cy="26.6" r=".5" fill="currentColor" />
        <circle cx="20.9" cy="27.7" r=".5" fill="currentColor" />
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
