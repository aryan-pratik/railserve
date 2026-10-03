import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import { sendLocations } from './api'
import { loadSession } from './storage'
import type { LocationPing } from './types'

/**
 * Sharing the rider's position with the admin board.
 *
 * Deliberately not routed through the offline mutation queue in `storage.ts`.
 * That queue's contract is retry-until-applied, because a delivery that never
 * reaches the server is work that disappears. A coordinate has the opposite
 * property: it is worthless a minute after it was taken, and retrying it
 * forever would redraw a stale path on the admin's map and compete for the
 * AsyncStorage the delivery queue actually depends on.
 *
 * So this is fire-and-forget and bounded. Fixes collect in a small ring buffer
 * and are sent every `POST_INTERVAL_MS`, kept or not. A phone with no signal
 * keeps the most recent `BUFFER_MAX` and loses the older ones, which is the
 * right thing to lose — on reconnecting, the office wants to know where the
 * rider is, not a perfect account of a corridor they walked ten minutes ago.
 *
 * One mechanism, not two. `startLocationUpdatesAsync` delivers in the
 * foreground as well as the background, so everything goes through the task
 * below. Running a `watchPositionAsync` watcher alongside it would double every
 * fix, and the guard needed to stop that is more failure surface than a second
 * path is worth.
 */

/** Keep in step with PING_INTERVAL_SECONDS on the server. */
const POST_INTERVAL_MS = 5_000

/** How often the OS is asked for a fix, and how far counts as having moved. */
const FIX_INTERVAL_MS = 10_000
const FIX_DISTANCE_M = 15

/**
 * Fixes held while offline. At one every ten seconds this is twenty minutes of
 * movement — enough to cover a station with no signal, and small enough that a
 * phone left somewhere cannot grow it without bound.
 */
const BUFFER_MAX = 120

/** The OS-level task name. Stable: the OS remembers it across app restarts. */
const TASK_NAME = 'railserve-location-updates'

export type SharingState =
  /** Not started, or stopped because the rider signed out. */
  | { status: 'off' }
  /** The rider declined the permission, or the OS has location switched off. */
  | { status: 'denied'; reason: string }
  /** Sharing, including while the screen is off. */
  | { status: 'sharing'; background: boolean; lastSentAt: number | null }
  /** Sharing, but the last send did not get through. */
  | { status: 'pending'; buffered: number }

type Listener = (state: SharingState) => void

let buffer: LocationPing[] = []
let timer: ReturnType<typeof setInterval> | null = null
let state: SharingState = { status: 'off' }
const listeners = new Set<Listener>()

/**
 * Bumped by every `stopSharing`, and checked after every await in
 * `startSharing`.
 *
 * Without it, signing out while the OS permission sheet is still open leaves
 * location updates running with no session: the stop happens first and finds
 * nothing registered, then the awaited prompt resolves and starts them anyway.
 * A rider who signed out would keep being tracked, which is the one failure
 * this feature must not have.
 */
let generation = 0

function setState(next: SharingState) {
  state = next
  for (const listener of listeners) listener(next)
}

export function getSharingState(): SharingState {
  return state
}

/** Subscribe to the indicator's state. Returns the unsubscribe. */
export function onSharingChange(listener: Listener): () => void {
  listeners.add(listener)
  listener(state)
  return () => listeners.delete(listener)
}

function toPing(fix: Location.LocationObject): LocationPing {
  return {
    lat: fix.coords.latitude,
    lng: fix.coords.longitude,
    accuracyMetres: fix.coords.accuracy,
    // Android reports a negative speed and heading when it has none to report.
    speedMetresPerSecond:
      fix.coords.speed !== null && fix.coords.speed >= 0 ? fix.coords.speed : null,
    headingDegrees:
      fix.coords.heading !== null && fix.coords.heading >= 0 ? fix.coords.heading : null,
    recordedAt: new Date(fix.timestamp).toISOString(),
  }
}

/**
 * The OS-level task, defined at module scope because that is the only place
 * that works: Android restarts the app headless to deliver a background batch,
 * and a task registered inside a component or a function does not exist yet
 * when that happens.
 *
 * It must therefore be entirely self-sufficient. In a headless start none of
 * the module state above has been initialised — `buffer` is empty, `listeners`
 * has nobody in it, and `setState` reaches no screen — so the task reads the
 * session from storage itself and posts directly rather than relying on the
 * timer below.
 */
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  TASK_NAME,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return

    const session = await loadSession()
    if (!session) {
      // No session, but the OS is still waking us for fixes. Unregister rather
      // than skip the batch: a task nobody stopped outlives the app itself and
      // would keep a signed-out rider's phone reporting forever.
      await stopLocationTask()
      return
    }

    const pings = data.locations.map(toPing)
    try {
      await sendLocations(session.token, pings)
      setState({ status: 'sharing', background: true, lastSentAt: Date.now() })
    } catch {
      // Hold them for the foreground timer to retry. In a headless start this
      // buffer dies with the process, which is the correct loss — the fixes
      // would be stale by the time anyone saw them.
      buffer = [...buffer, ...pings].slice(-BUFFER_MAX)
    }
  },
)

/**
 * Send whatever has collected.
 *
 * The buffer is taken before the request and only put back on failure, so a
 * fix arriving mid-flight is not sent twice — and on success it is simply
 * gone, because the server has it and a resend would be a duplicate the server
 * would ignore anyway.
 */
async function flush(token: string) {
  if (buffer.length === 0) return
  const sending = buffer
  buffer = []

  try {
    await sendLocations(token, sending)
    setState({ status: 'sharing', background: await hasBackgroundPermission(), lastSentAt: Date.now() })
  } catch {
    // No signal, or the server said no. Keep the newest and try on the next
    // tick; nothing here is worth an error in front of a rider mid-delivery.
    buffer = [...sending, ...buffer].slice(-BUFFER_MAX)
    setState({ status: 'pending', buffered: buffer.length })
  }
}

async function hasBackgroundPermission(): Promise<boolean> {
  try {
    return (await Location.getBackgroundPermissionsAsync()).granted
  } catch {
    return false
  }
}

async function stopLocationTask(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(TASK_NAME)) {
      await Location.stopLocationUpdatesAsync(TASK_NAME)
    }
  } catch {
    // Nothing registered, or the module is unavailable. Either way there is
    // nothing left running to stop.
  }
}

/**
 * Ask Android to switch location on, if it is off.
 *
 * `enableNetworkProviderAsync` puts up the system dialog — the one that offers
 * to turn on location with a single tap — rather than telling the rider to go
 * hunting through Settings. It rejects when they decline, which is a real
 * answer and not an error.
 */
async function promptForLocationServices(): Promise<boolean> {
  try {
    if (await Location.hasServicesEnabledAsync()) return true
  } catch {
    return false
  }

  try {
    await Location.enableNetworkProviderAsync()
  } catch {
    return false
  }

  // Re-check rather than trusting the dialog: on some devices it resolves
  // whether or not anything was actually switched on.
  try {
    return await Location.hasServicesEnabledAsync()
  } catch {
    return false
  }
}

/**
 * Start sharing. Safe to call repeatedly — a second call with the same session
 * is a no-op rather than a second registration.
 */
export async function startSharing(token: string): Promise<void> {
  const mine = generation

  try {
    const existing = await Location.getForegroundPermissionsAsync()
    if (mine !== generation) return
    const foreground =
      existing.granted || (await Location.requestForegroundPermissionsAsync()).granted
    if (mine !== generation) return

    if (!foreground) {
      setState({
        status: 'denied',
        reason: 'Location permission is off. Turn it on so the office can see where you are.',
      })
      return
    }

    if (!(await promptForLocationServices())) {
      if (mine !== generation) return
      setState({ status: 'denied', reason: 'Location is switched off on this phone.' })
      return
    }
    if (mine !== generation) return

    // Asked separately, and allowed to fail. A rider who declines "all the
    // time" keeps sharing while the app is open — on Android a foreground
    // service carries that without the background permission. Declining costs
    // screen-off tracking, not tracking.
    let background = await hasBackgroundPermission()
    if (!background) {
      try {
        background = (await Location.requestBackgroundPermissionsAsync()).granted
      } catch {
        background = false
      }
    }
    if (mine !== generation) return

    if (!(await Location.hasStartedLocationUpdatesAsync(TASK_NAME))) {
      if (mine !== generation) return
      await Location.startLocationUpdatesAsync(TASK_NAME, {
        // Balanced, not Highest. A platform is the unit that matters and
        // Balanced resolves to well inside it, while Highest pins the GPS on
        // for a whole shift — a rider whose phone dies at 4pm cannot take a
        // delivery, which costs more than the extra few metres are worth.
        accuracy: Location.Accuracy.Balanced,
        timeInterval: FIX_INTERVAL_MS,
        distanceInterval: FIX_DISTANCE_M,
        // No foregroundService. On Android that option is what posts the
        // "RailServe is sharing your location" notification, and riders found
        // it noise: once they have granted the permission, the system's own
        // location indicator in the status bar is all they should see. The
        // cost is that Android batches background fixes more coarsely while
        // the app is not on screen; with the app open nothing changes.
        showsBackgroundLocationIndicator: true,
      })
    }

    // The session ended while this was being set up.
    if (mine !== generation) {
      await stopLocationTask()
      return
    }

    setState({ status: 'sharing', background, lastSentAt: null })
    if (!timer) timer = setInterval(() => void flush(token), POST_INTERVAL_MS)
  } catch {
    if (mine === generation) {
      setState({ status: 'denied', reason: 'This phone could not start location sharing.' })
    }
  }
}

/**
 * Stop, and forget what was buffered. Called on sign-out.
 *
 * Unregisters the OS task, not just the timer. The task is the half that
 * survives the app being closed, so leaving it behind would keep waking a
 * signed-out rider's phone indefinitely.
 */
export async function stopSharing(): Promise<void> {
  // Invalidates any startSharing still waiting on a permission prompt.
  generation += 1
  if (timer) clearInterval(timer)
  timer = null
  buffer = []
  setState({ status: 'off' })
  await stopLocationTask()
}

/**
 * Send now rather than on the next tick. Called when the app comes forward,
 * which is exactly when a phone that was in a station gets signal back.
 */
export function flushNow(token: string): void {
  void flush(token)
}
