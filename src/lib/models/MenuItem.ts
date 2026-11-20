import { Schema, type InferSchemaType, type Model } from 'mongoose'
import { registerModel } from './registerModel'
import { ORDER_SOURCES } from '../orderEnums'
import { DIETS } from '../diet'

/**
 * One dish as one aggregator names it, and whether it is veg or non-veg.
 *
 * Per aggregator, because each one names the same food its own way ("Aloo
 * Paratha", "Majedaar Aloo Paratha", "Aloo Paratha with Soft Drink") and a
 * name is only trusted inside the menu it came from. The KOT splits veg and
 * non-veg from this table alone (see lib/diet.ts): nothing reads an item's
 * name at print time to guess.
 *
 * Rows arrive three ways: the seed script reads every order already received,
 * every new order registers the dishes it carries, and the Menu page itself
 * fills in any dish it finds in the orders that is still missing. A new row
 * gets a suggested tag (or none, when the name does not say) and
 * `reviewed: false` until somebody confirms it.
 *
 * `_id` is menuLookupKey(source, name): "RELFOOD|aloo paratha". That makes
 * one row per dish per aggregator a property of the collection itself. Two
 * orders arriving together cannot create the dish twice, and nothing depends
 * on an index having been built first.
 */
const MenuItemSchema = new Schema(
  {
    _id: { type: String, required: true },
    source: { type: String, required: true, enum: ORDER_SOURCES },
    // menuKey(name): the second half of _id, kept apart for reading.
    key: { type: String, required: true },
    // The name as first seen, for people to read.
    name: { type: String, required: true, trim: true },
    // Null means nobody has tagged it and no suggestion was made.
    diet: { type: String, default: null, enum: [...DIETS, null] },
    // False while the tag is only a suggestion. Set when a person picks it.
    reviewed: { type: Boolean, default: false },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true, strict: true, strictQuery: true },
)

export type MenuItemDoc = InferSchemaType<typeof MenuItemSchema> & { _id: string }

export const MenuItem: Model<MenuItemDoc> = registerModel<MenuItemDoc>('MenuItem', MenuItemSchema)

export { MenuItemSchema }
