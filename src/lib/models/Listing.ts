import mongoose, { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'
import { ORDER_SOURCES } from '../orderEnums'

/**
 * A storefront name an aggregator puts in its order mail, and the outlet of
 * ours that actually cooks it.
 *
 * This exists because the two things were the same row for a year and should
 * never have been. `Restaurant` is OUR kitchen — Hotel Ganga Galaxy, The
 * Cosmozin Lounge. What arrives in a Yatri Bhojan mail is not that: it is
 * whatever name our kitchen trades under on Yatri Bhojan's app. Storing those
 * as outlets meant Kanpur Central had seven "outlets" for two real kitchens,
 * staff had to be assigned to all seven to see one stove's work, and adding an
 * aggregator meant editing every user.
 *
 * So the aggregator's name lives here, pointing at the outlet behind it, and
 * `Restaurant` goes back to meaning one thing.
 *
 * Note what is NOT here: the aggregator itself. That is already
 * `Order.source`, and has been all along — the one part of this that was
 * modelled correctly from the start. `source` on this row is a label for the
 * admin screen and a tiebreaker, never the routing key: one aggregator
 * legitimately names several different outlets of ours (YatriRestro mails name
 * Hotel Ganga Galaxy, The Cosmozin Lounge and "Yatri Restro"), so routing by
 * aggregator alone would send two of those three to the wrong kitchen.
 */
const ListingSchema = new Schema(
  {
    // Exactly as the aggregator writes it. Matched case- and
    // whitespace-insensitively; stored as-seen so the admin screen shows the
    // operator what the mail actually says.
    name: { type: String, required: true, trim: true },
    // Other spellings of the same storefront. Aggregators rename things.
    aliases: { type: [String], default: [] },
    // Which aggregator uses this name. Null when it is not known or the name
    // is shared — see the class comment: this is a label, not the routing key.
    source: { type: String, default: null, enum: [...ORDER_SOURCES, null] },
    // The station the storefront trades at, used to cross-check the mail and
    // to find a default outlet when this row points at none.
    stationCode: { type: String, required: true, uppercase: true, trim: true },
    // The kitchen that cooks it. Null is a legitimate state: a storefront we
    // have seen but nobody has mapped yet, which falls back to the station's
    // default outlet rather than refusing the order.
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type ListingDoc = InferSchemaType<typeof ListingSchema> & { _id: mongoose.Types.ObjectId }

export const Listing: Model<ListingDoc> = registerModel<ListingDoc>('Listing', ListingSchema)

export { ListingSchema }
