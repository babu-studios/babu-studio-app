export function AudioMeter({ label, level }: { label: string; level: number }) {
  return (
    <div className="audio-meter-row">
      <span className="audio-control-label">Input level</span>
      <div
        className="audio-meter"
        role="meter"
        aria-label={`${label} input level`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={level}
        aria-valuetext={`${level}%`}
      >
        <span
          style={{
            width: `${level}%`,
            background: "linear-gradient(to right, #83d6b5 0% 60%, #e4c65e 60% 80%, #ec7777 80% 100%)",
            backgroundSize: `${10000 / Math.max(level, 1)}% 100%`,
          }}
        />
      </div>
    </div>
  );
}
