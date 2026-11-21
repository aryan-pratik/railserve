'use server'

import { revalidatePath } from 'next/cache'
import mongoose from 'mongoose'
import { requireRole } from '@/lib/session'
import { connectDb } from '@/lib/db'
import { User } from '@/lib/models'
import {
  saveRestaurant,
  toggleRestaurantActive,
  deleteRestaurant,
  type RestaurantState,
  type DeleteState as OutletDeleteState,
} from '@/app/admin/setup/outletActions'
import { saveUser, toggleUserActive, deleteUser, type UserState, type DeleteState as StaffDeleteState } from '@/app/admin/setup/staffActions'
import { addAllowedSender, removeAllowedSender, type SenderState } from '@/app/admin/setup/senderActions'
import { setListingOutlet, setStationDefault, toggleListingActive, type ListingState } from '@/app/admin/setup/listingActions'

/*
 * Thin v2 wrappers. The v1 setup actions own the rules and revalidate
 * /admin/setup; these call the same function and also revalidate this page,
 * so nothing about outlets, staff or routing exists twice.
 */

const V2 = '/v2/settings'

export type { RestaurantState, UserState, SenderState, ListingState, OutletDeleteState, StaffDeleteState }

export async function saveOutlet(prev: RestaurantState, formData: FormData): Promise<RestaurantState> {
  const r = await saveRestaurant(prev, formData)
  revalidatePath(V2)
  return r
}

export async function toggleOutletActive(formData: FormData): Promise<void> {
  await toggleRestaurantActive(formData)
  revalidatePath(V2)
}

export async function deleteOutlet(prev: OutletDeleteState, formData: FormData): Promise<OutletDeleteState> {
  const r = await deleteRestaurant(prev, formData)
  revalidatePath(V2)
  return r
}

export async function saveStaff(prev: UserState, formData: FormData): Promise<UserState> {
  const r = await saveUser(prev, formData)
  revalidatePath(V2)
  return r
}

export type ToggleState = { error?: string }

/**
 * Deactivating is the normal way to retire an account, but two cases lock
 * people out instead: your own account (the next request bounces you to the
 * login) and the last active admin (nobody can reach this page again). v1's
 * toggle has no return channel, so the guard lives here, before the call.
 */
export async function toggleStaffActive(_prev: ToggleState, formData: FormData): Promise<ToggleState> {
  const ctx = await requireRole('ADMIN')
  const id = String(formData.get('id') ?? '')
  const active = String(formData.get('active') ?? '') === 'true'
  if (!mongoose.isValidObjectId(id)) return { error: 'That staff member no longer exists.' }

  if (!active) {
    if (ctx.userId.equals(id)) return { error: "You can't deactivate your own account." }
    await connectDb()
    const target = await User.findById(id).select('role active').lean()
    if (!target) return { error: 'That staff member no longer exists.' }
    if (target.role === 'ADMIN' && target.active !== false) {
      const admins = await User.countDocuments({ role: 'ADMIN', active: true })
      if (admins <= 1) return { error: 'This is the last active admin. Deactivating them would lock everyone out.' }
    }
  }

  await toggleUserActive(formData)
  revalidatePath(V2)
  return {}
}

export async function deleteStaff(prev: StaffDeleteState, formData: FormData): Promise<StaffDeleteState> {
  const r = await deleteUser(prev, formData)
  revalidatePath(V2)
  return r
}

export async function addSender(prev: SenderState, formData: FormData): Promise<SenderState> {
  const r = await addAllowedSender(prev, formData)
  revalidatePath(V2)
  return r
}

export async function removeSender(formData: FormData): Promise<void> {
  await removeAllowedSender(formData)
  revalidatePath(V2)
}

export async function routeListing(prev: ListingState, formData: FormData): Promise<ListingState> {
  const r = await setListingOutlet(prev, formData)
  revalidatePath(V2)
  return r
}

export async function setListingActive(formData: FormData): Promise<void> {
  await toggleListingActive(formData)
  revalidatePath(V2)
}

export async function setStationKitchen(formData: FormData): Promise<void> {
  await setStationDefault(formData)
  revalidatePath(V2)
}
