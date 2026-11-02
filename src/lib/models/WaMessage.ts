import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'

export const WA_DIRECTIONS = ['IN', 'OUT'] as const
export type WaDirection = (typeof WA_DIRECTIONS)[number]

export const WA_KINDS = ['TEXT', 'TEMPLATE', 'MEDIA', 'OTHER'] as const
export type WaKind = (typeof WA_KINDS)[number]

/**
 * Where an outbound message has got to, in the order the provider reports
 * them. An inbound message is simply RECEIVED. FAILED can follow any state.
 */
export const WA_STATUSES = ['QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'RECEIVED'] as const
export type WaStatus = (typeof WA_STATUSES)[number]

/**
 * One WhatsApp message, in or out.
 *
 * Its own collection rather than an array on the conversation: a thread with
 * a regular passenger runs to hundreds of lines, and the list pane reads
 * conversations without wanting any of them.
 *
 * `providerMessageId` is WhatsApp's own id (`wamid.…`). It is what a status
 * report refers back to, and the unique partial index on it is what makes a
 * webhook replay a no-op rather than a duplicate line in the thread.
 */
const WaMessageSchema = new Schema(
  {
    conversationId: { type: Schema.Types.ObjectId, ref: 'WaConversation', required: true },
    direction: { type: String, required: true, enum: WA_DIRECTIONS },
    kind: { type: String, required: true, enum: WA_KINDS, default: 'TEXT' },
    text: { type: String, default: null },
    // A photo, document or voice note the passenger sent: the provider's URL
    // and whatever caption or filename came with it.
    mediaUrl: { type: String, default: null },
    mediaCaption: { type: String, default: null },
    templateName: { type: String, default: null },

    status: { type: String, required: true, enum: WA_STATUSES },
    statusAt: { type: Date, default: null },
    failReason: { type: String, default: null },

    // Deliberately NOT `default: null`: the unique index is partial on string
    // values, so a message with no provider id must omit the key entirely.
    providerMessageId: { type: String },
    // MSG91's own request id, reported back before the wamid is known.
    providerRequestId: { type: String, default: null },

    // The telecaller (or admin) who sent it. Null on inbound.
    sentBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { strict: true, strictQuery: true, versionKey: false },
)

export type WaMessageDoc = InferSchemaType<typeof WaMessageSchema> & { _id: mongoose.Types.ObjectId }

export const WaMessage: Model<WaMessageDoc> =
  registerModel<WaMessageDoc>('WaMessage', WaMessageSchema)

export { WaMessageSchema }
