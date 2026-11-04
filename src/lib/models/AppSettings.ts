import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'
import { ROLES } from '../roles'
import { DEFAULT_RTO_COLLECT_ROLES } from '../rto'

/**
 * Singleton row of admin-set switches that are not about one outlet, one
 * station or one aggregator — the things that used to need a redeploy to
 * change. One document, `_id: 'app'`, read through lib/repo/settingsRepo.
 *
 * IngestState is the same shape for the Gmail side; this is for everything
 * that is not ingestion.
 */
const AppSettingsSchema = new Schema(
  {
    _id: { type: String, required: true },
    // Who may mark a returned order as back at the counter (see lib/rto.ts).
    // An admin always can and is never listed here.
    rtoCollectRoles: {
      type: [{ type: String, enum: ROLES }],
      default: () => [...DEFAULT_RTO_COLLECT_ROLES],
    },
  },
  { timestamps: true, strict: true, strictQuery: true, versionKey: false },
)

export type AppSettingsDoc = InferSchemaType<typeof AppSettingsSchema> & { _id: string }

export const AppSettings: Model<AppSettingsDoc> =
  registerModel<AppSettingsDoc>('AppSettings', AppSettingsSchema)

export const APP_SETTINGS_ID = 'app'
