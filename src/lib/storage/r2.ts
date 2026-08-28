import { randomUUID } from 'node:crypto'
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import {
  isAllowedContentType,
  ProofStoreUnavailable,
  type PresignedUpload,
  type ProofStore,
} from './provider'

/**
 * Cloudflare R2, via the S3 API.
 *
 * R2 is S3-compatible, so the AWS SDK works unchanged against R2's endpoint
 * with region "auto". Signing is delegated to the SDK rather than hand-rolled:
 * SigV4 is easy to get subtly wrong, and a wrong signature here is either a
 * broken upload at a station or a URL that grants more than it should.
 */
const UPLOAD_TTL_SECONDS = 10 * 60
const DOWNLOAD_TTL_SECONDS = 15 * 60

export class R2ProofStore implements ProofStore {
  readonly name = 'r2'
  readonly available = true

  private readonly client: S3Client

  constructor(
    private readonly bucket: string,
    accountId: string,
    accessKeyId: string,
    secretAccessKey: string,
  ) {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    })
  }

  async presignUpload({
    orderId,
    contentType,
  }: {
    orderId: string
    contentType: string
  }): Promise<PresignedUpload> {
    if (!isAllowedContentType(contentType)) {
      throw new ProofStoreUnavailable(`${contentType} is not an accepted image type`)
    }

    // Date-partitioned so a bucket listing is navigable, and suffixed with a
    // random id so two riders photographing the same order cannot collide.
    const day = new Date().toISOString().slice(0, 10)
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'
    const key = `proof/${day}/${orderId}-${randomUUID()}.${ext}`

    const uploadUrl = await getSignedUrl(
      this.client,
      new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }),
      { expiresIn: UPLOAD_TTL_SECONDS },
    )

    return {
      uploadUrl,
      key,
      expiresAt: new Date(Date.now() + UPLOAD_TTL_SECONDS * 1000),
    }
  }

  async presignDownload(key: string): Promise<string> {
    return getSignedUrl(
      this.client,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: DOWNLOAD_TTL_SECONDS },
    )
  }
}
