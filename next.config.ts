import type { NextConfig } from 'next'

// VS Code dev tunnels serve the app from `*.devtunnels.ms`, but the tunnel
// relay and the local server disagree on the request's origin: the CSRF
// check compares the `Origin` header against `Host`/`X-Forwarded-Host`, and
// depending on how the tunnel is reached, either the devtunnels hostname or
// bare `localhost:3000` shows up as `Origin` while the other shows up as the
// host. Either mismatch gets a Server Action rejected with "Invalid Server
// Actions request." — and the same mismatch blocks cross-origin `/_next` dev
// assets — so both sides need to be listed as trusted.
// Anyone can register a devtunnels subdomain, so this allowance is dev-only:
// carrying it into production would hand that wildcard a real CSRF bypass.
// (`*` matches exactly one label; `**` is needed to span the region prefix.)
// '100.108.31.61' is a Tailscale address this app gets opened from during dev
// (another device on the tailnet) — same cross-origin dev-asset block as the
// tunnel case above, just a raw IP instead of a hostname.
const devTunnelOrigins = ['**.devtunnels.ms', 'localhost:3000', '100.108.31.61']
const isDev = process.env.NODE_ENV !== 'production'

// Set only for the VM build, where nginx shares port 8080 with another app
// and gives railserve the /railserve path prefix rather than its own origin.
// Must be set at build time — Next inlines it into client bundles — so this
// stays unset for local dev and for a plain `npm run build`.
const basePath = process.env.BASE_PATH || undefined

const nextConfig: NextConfig = {
  // Keep the MongoDB driver out of the bundler entirely. It reaches for `tls`,
  // `net` and `timers/promises` at require time, which Turbopack cannot resolve
  // for a browser target — and a stray client import of a server module turns
  // into a confusing module-not-found rather than a clear boundary error.
  serverExternalPackages: ['mongoose'],
  basePath,
  ...(isDev
    ? {
        allowedDevOrigins: devTunnelOrigins,
        experimental: { serverActions: { allowedOrigins: devTunnelOrigins } },
      }
    : {}),
}

export default nextConfig
