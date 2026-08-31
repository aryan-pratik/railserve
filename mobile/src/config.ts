import Constants from 'expo-constants'
import { Platform } from 'react-native'

/**
 * Base URL of the RailServe web app.
 *
 * A phone cannot reach `localhost` — that is the phone itself. In development
 * the address has to be one both machines agree on, and that address is not
 * knowable ahead of time: it is a LAN IP at the office and a Tailscale IP over
 * a tunnel. So it is derived rather than configured.
 *
 * On web the browser already knows it: whatever host was typed to load the app
 * is reachable from this device by definition. On native, Expo reports the dev
 * server's host, which is the same machine serving the API.
 *
 * EXPO_PUBLIC_API_URL overrides both and is what a real build uses — it is
 * inlined at bundle time, so eas.json sets it and nothing here runs.
 */
function inferDevHost(): string | null {
  if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.hostname) {
    return `${window.location.protocol}//${window.location.hostname}:3000`
  }

  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost
  const host = hostUri?.split(':')[0]
  return host ? `http://${host}:3000` : null
}

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? inferDevHost() ?? 'http://localhost:3000'

/** The one URL a rider should never see a warning banner over. */
const PRODUCTION_API_URL = 'https://railserve.vercel.app'

/** True for any build/dev session not talking to the real production backend. */
export const IS_NOT_PRODUCTION = API_URL !== PRODUCTION_API_URL
