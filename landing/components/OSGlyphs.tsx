/**
 * Original, simplified platform glyphs used only to indicate OS compatibility
 * (nominative use). These are hand-drawn paths, not the official brand logos.
 */

export function LinuxGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 3c-2 0-3 2-3 4 0 1.4.3 2.3-.6 3.6C7 12.4 6 13.8 6 15.6 6 18 8 19 8 20.2c0 .5-.4.8-1 .8 1.5.6 3 .6 5 .6s3.5 0 5-.6c-.6 0-1-.3-1-.8C16 19 18 18 18 15.6c0-1.8-1-3.2-2.4-5C14.7 9.3 15 8.4 15 7c0-2-1-4-3-4Z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="10.5" cy="8" r=".9" fill="currentColor" />
      <circle cx="13.5" cy="8" r=".9" fill="currentColor" />
    </svg>
  );
}

export function MacGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.4 12.7c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-2.9.9-3.7 2.3-1.6 2.7-.4 6.8 1.1 9 .7 1.1 1.6 2.3 2.8 2.3 1.1 0 1.5-.7 2.9-.7 1.3 0 1.7.7 2.9.7 1.2 0 2-1.1 2.7-2.2.9-1.2 1.2-2.5 1.2-2.5s-2.3-.9-2.3-3.7ZM14.2 5.5c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.6 1.3-.6.7-1.1 1.7-.9 2.7 1 .1 2-.5 2.6-1.1Z" />
    </svg>
  );
}

export function WinGlyph({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3 5.5 10.5 4.5v7H3v-6ZM10.5 12.5v7L3 18.5v-6h7.5ZM11.5 4.3 21 3v8.5h-9.5v-7.2ZM21 12.5V21l-9.5-1.3v-7.2H21Z" />
    </svg>
  );
}
