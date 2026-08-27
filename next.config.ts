import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Keep the MongoDB driver out of the bundler entirely. It reaches for `tls`,
  // `net` and `timers/promises` at require time, which Turbopack cannot resolve
  // for a browser target — and a stray client import of a server module turns
  // into a confusing module-not-found rather than a clear boundary error.
  serverExternalPackages: ['mongoose'],
}

export default nextConfig
