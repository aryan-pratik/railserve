import type { AuthContext } from '@/lib/authContext'
import { can } from '@/lib/access'
import { loadRoleAccess } from '@/lib/repo/companyRepo'
import { RoleAccessForm } from '@/components/v2/RoleAccessForm'

/** Settings → Roles & access: the permission matrix for the caller's company. */
export async function RolesTab({ ctx }: { ctx: AuthContext }) {
  const [{ granted, editableRoles }, canEdit] = await Promise.all([loadRoleAccess(ctx), can(ctx, 'roles.manage')])
  return <RoleAccessForm granted={granted} editableRoles={editableRoles} canEdit={canEdit} />
}
