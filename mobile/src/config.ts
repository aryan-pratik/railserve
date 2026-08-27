import Constants from 'expo-constants'

/**
 * Base URL of the RailServe web app.
 *
 * A phone cannot reach `localhost` — that is the phone itself. In development
 * we derive the dev machine's LAN address from the Expo host, which is the one
 * address we know both devices agree on. Override with EXPO_PUBLIC_API_URL for
 * a real deployment.
 */
function inferDevHost(): string | null {
  const hostUri =
    Constants.expoConfig?.hostUri ??
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)?.debuggerHost
  if (!hostUri) return null
  const host = hostUri.split(':')[0]
  return host ? `http://${host}:3000` : null
}

export const API_URL =
  process.env.EXPO_PUBLIC_API_URL ?? inferDevHost() ?? 'http://localhost:3000'
