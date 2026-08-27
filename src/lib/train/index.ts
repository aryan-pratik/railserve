import { env } from '../env'
import type { TrainStatusProvider } from './provider'
import { SimulatedTrainStatusProvider } from './simulator'
import { RapidApiTrainStatusProvider } from './rapidapi'

/**
 * THE one-file provider swap (plan §8).
 *
 * Nothing outside this directory imports a concrete provider, so changing
 * vendor means editing this function and nothing else.
 */
let cached: TrainStatusProvider | null = null

export function getTrainStatusProvider(
  scheduledArrivalFor?: (trainNo: string) => Date | null,
): TrainStatusProvider {
  // The simulator needs a scheduled time to offset, so it is rebuilt per call
  // site rather than memoised.
  if (env.TRAIN_API_PROVIDER === 'simulator' || !env.TRAIN_API_KEY) {
    return new SimulatedTrainStatusProvider(scheduledArrivalFor)
  }
  cached ??= new RapidApiTrainStatusProvider(env.TRAIN_API_KEY, env.TRAIN_API_HOST)
  return cached
}

/** True when real upstream data is in use — surfaced in the UI so nobody demos a simulation by accident. */
export function isSimulatedProvider(): boolean {
  return env.TRAIN_API_PROVIDER === 'simulator' || !env.TRAIN_API_KEY
}

export * from './provider'
export * from './policy'
