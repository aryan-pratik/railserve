/** A small circle that turns. Sized to the text it sits beside. */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      className={`motion-safe:animate-spin ${className}`}
      aria-hidden
    >
      <circle cx="12" cy="12" r="9" className="opacity-25" />
      <path d="M21 12a9 9 0 0 0-9-9" />
    </svg>
  )
}
