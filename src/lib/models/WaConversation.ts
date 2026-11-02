import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'

/**
 * One WhatsApp thread with one passenger, keyed by their number.
 *
 * A passenger is one phone number, whatever they ordered and however many
 * times — WhatsApp itself has exactly one thread per number, and splitting
 * ours per order would put the passenger's "where is my food" and our reply
 * in two different places. The order the thread is *about* right now is a
 * pointer (`orderId`), re-aimed at whichever order the passenger last wrote
 * about or a telecaller last opened the chat from.
 *
 * `restaurantId` is what scopes the thread: a telecaller sees the threads of
 * the outlets they hold, plus any thread no outlet has claimed yet (a number
 * that wrote in with no order on file), because somebody has to answer it.
 *
 * The denormalised `last*` fields exist for the list pane, which must not
 * read every message of every thread to draw one line each.
 */
const WaConversationSchema = new Schema(
  {
    // Digits only, with the country code: 919876543210. The provider's own
    // shape, and what a webhook hands back, so a lookup is one equality.
    phone: { type: String, required: true, trim: true },
    customerName: { type: String, default: null, trim: true },

    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
    // Who is answering this passenger. Null until a telecaller takes it or
    // sends the first reply; see assignConversation.
    assignedTo: { type: Schema.Types.ObjectId, ref: 'User', default: null },

    lastMessageAt: { type: Date, default: null },
    lastMessageText: { type: String, default: null },
    lastMessageDirection: { type: String, default: null, enum: ['IN', 'OUT', null] },
    // The customer-service window WhatsApp allows free-text replies in is 24
    // hours from the passenger's last message. Measured from this.
    lastInboundAt: { type: Date, default: null },
    // Inbound messages nobody has opened the thread to read yet.
    unreadCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type WaConversationDoc = InferSchemaType<typeof WaConversationSchema> & {
  _id: mongoose.Types.ObjectId
}

export const WaConversation: Model<WaConversationDoc> =
  registerModel<WaConversationDoc>('WaConversation', WaConversationSchema)

export { WaConversationSchema }
