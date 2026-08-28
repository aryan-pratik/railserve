/**
 * Where delivery proof photos live.
 *
 * Behind an interface for the same reason TrainStatusProvider is: the vendor is
 * a detail, and swapping R2 for S3 or MinIO must be a one-file change. Nothing
 * outside src/lib/storage imports a concrete implementation.
 *
 * Photos never pass through this server. The rider's device asks for a
 * presigned URL and PUTs straight to the bucket — a 3 MB JPEG over a station's
 * patchy connection has no business being proxied, and the app process should
 * not hold image buffers in memory to no purpose.
 */
export type PresignedUpload = {
  /** PUT the image bytes here, with the same Content-Type that was requested. */
  uploadUrl: string
  /** What to store in `delivery.proofValue`. Never a full URL — those expire. */
  key: string
  expiresAt: Date
}

export interface ProofStore {
  readonly name: string
  /** True when the store is configured and usable. */
  readonly available: boolean
  presignUpload(input: { orderId: string; contentType: string }): Promise<PresignedUpload>
  /** A short-lived URL for viewing a stored photo. */
  presignDownload(key: string): Promise<string>
}

export class ProofStoreUnavailable extends Error {
  constructor(message = 'Proof storage is not configured') {
    super(message)
    this.name = 'ProofStoreUnavailable'
  }
}

/** Only these become photos. Anything else is a bug or an attack. */
export const ALLOWED_PROOF_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export function isAllowedContentType(t: string): boolean {
  return (ALLOWED_PROOF_TYPES as readonly string[]).includes(t)
}
