// Inline icons — stroke inherits currentColor so they tint with their context.

export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1000 1000" fill="none" aria-hidden>
      <path
        d="M736.4,315.3 A300,300 0 1 0 736.4,684.7"
        stroke="var(--mint)"
        strokeWidth="86"
        strokeLinecap="round"
      />
      <circle cx="800" cy="500" r="44" fill="var(--mint)" />
    </svg>
  );
}

export function Bolt() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor" />
    </svg>
  );
}

export function Coin() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
      <path d="M12 7v10M9.5 9.2c0-1.1 1.1-1.7 2.5-1.7s2.5.7 2.5 1.8c0 2.6-5 1.4-5 4 0 1.1 1.1 1.8 2.5 1.8s2.5-.6 2.5-1.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

export function Local() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="4" width="18" height="13" rx="2" stroke="currentColor" strokeWidth="2" />
      <path d="M8 21h8M12 17v4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function Lock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden width="16" height="16">
      <rect x="4.5" y="10" width="15" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export function Star({ filled = false }: { filled?: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} aria-hidden>
      <path
        d="M12 3.5l2.6 5.27 5.82.85-4.21 4.1.99 5.79L12 16.77l-5.2 2.73.99-5.79-4.21-4.1 5.82-.85L12 3.5Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function Back() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M15 5l-7 7 7 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Gpu() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.8" />
      <rect x="6.5" y="9.5" width="7" height="5" rx="1" stroke="currentColor" strokeWidth="1.6" />
      <path d="M16.5 10.5h2.2M16.5 13h2.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M4 12 20 4l-4 16-4-7-8-1Z" fill="currentColor" />
    </svg>
  );
}
