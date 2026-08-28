import { env } from '../env'
import { R2ProofStore } from './r2'
import { ProofStoreUnavailable, type PresignedUpload, type ProofStore } from './provider'

export * from './provider'

/**
 * Used when R2 is not configured.
 *
 * Photo proof is optional by design — a rider on a platform with no signal
 * still has to be able to close an order. So an unconfigured store is a normal
 * state, not a boot error: the app runs, delivery works, and the capture button
 * simply does not appear. Failing loudly here would make the photo mandatory by
 * accident, which is the opposite of the decision.
 */
class UnconfiguredProofStore implements ProofStore {
  readonly name = 'none'
  readonly available = false

  async presignUpload(): Promise<PresignedUpload> {
    throw new ProofStoreUnavailable(
      'Photo proof storage is not configured — set the R2_* variables to enable it.',
    )
  }

  async presignDownload(): Promise<string> {
    throw new ProofStoreUnavailable('Photo proof storage is not configured')
  }
}

let cached: ProofStore | null = null

export function getProofStore(): ProofStore {
  if (cached) return cached

  const { R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY } = env
  cached =
    R2_ACCOUNT_ID && R2_BUCKET && R2_ACCESS_KEY_ID && R2_SECRET_ACCESS_KEY
      ? new R2ProofStore(R2_BUCKET, R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)
      : new UnconfiguredProofStore()

  return cached
}

export function isProofStorageConfigured(): boolean {
  return getProofStore().available
}
