import mongoose, { model, models, type Model, type Schema } from 'mongoose'

/**
 * Compiles a model, or hands back the one already compiled under this name.
 *
 * The `models.X ?? model('X', schema)` idiom every model here used exists
 * because Next re-evaluates these modules on each HMR pass and Mongoose throws
 * when a name is registered twice. It has a sharp edge in development: the
 * cached model keeps the schema it was *first* compiled with, so editing a
 * schema changes nothing until the server is restarted — and because every
 * schema here sets `strict: true`, Mongoose then silently strips the new path
 * out of every write. The save reports success, `modifiedCount` still comes
 * back as 1 because `timestamps: true` bumps `updatedAt` regardless, and
 * nothing persists. That is a genuinely miserable afternoon; `callLog` cost
 * one.
 *
 * So in development the model is recompiled from the current schema on every
 * pass. Production is deliberately untouched — there is no HMR there, and
 * tearing down and rebuilding models on a live server is not something to do
 * for no reason.
 */
export function registerModel<T>(name: string, schema: Schema): Model<T> {
  if (process.env.NODE_ENV !== 'production' && models[name]) {
    mongoose.deleteModel(name)
  }
  return (models[name] as Model<T>) ?? (model(name, schema) as unknown as Model<T>)
}
