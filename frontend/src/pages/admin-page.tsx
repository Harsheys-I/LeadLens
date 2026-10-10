import { useEffect, useState } from 'react'
import { Shield, UserPlus, Users } from 'lucide-react'
import Loader from '@/components/ui/loader.tsx'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'
import SmoothDrawer from '@/components/ui/smooth-drawer.tsx'
import SmoothTab, { type TabItem } from '@/components/ui/smooth-tab.tsx'
import SpotlightCards from '@/components/ui/spotlight-cards.tsx'
import { AdminApi } from '@/lib/api.ts'
import { useAuth } from '@/lib/auth.tsx'
import { useView } from '@/lib/use-view.ts'

type Role = { id: number; name: string; rank?: number; role_key?: string; permissions?: string[]; is_system?: boolean }
type Perm = { id: string; label: string; group: string }
type Person = { id: number; username: string; display_name?: string; role_name?: string; role_id?: number; telecaller_name?: string; role_key?: string }
type RequestRow = { id: number; full_name?: string; requested_username?: string; preferred_module?: string; reason?: string }

const inputClass = 'w-full rounded-xl border border-zinc-200 bg-[var(--panel)] px-3 py-2 text-sm text-[var(--ink)] dark:border-zinc-700'

export default function AdminPage() {
  const { hasPermission, user } = useAuth()
  const allowed = [
    hasPermission('admin.users') || user?.is_super ? 'users' : '',
    hasPermission('admin.roles') || user?.is_super ? 'roles' : '',
  ].filter(Boolean)
  const { view, select } = useView(allowed.length ? allowed : ['users'], allowed[0] || 'users')
  const items = [
    { id: 'users', name: 'User creation' },
    { id: 'roles', name: 'Roles' },
  ].filter((item) => allowed.includes(item.id))

  return (
    <SmoothTab
      items={items.map((item) => ({ id: item.id, title: item.id === 'users' ? 'Users' : 'Roles', color: 'bg-zinc-900 dark:bg-white' }))}
      selected={view}
      onChange={select}
    >
      {view === 'users' ? <UsersView /> : <RolesView />}
    </SmoothTab>
  )
}

function UsersView() {
  const [people, setPeople] = useState<Person[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')
  const [creating, setCreating] = useState(false)

  async function reload() {
    const [userData, requestData, roleData] = await Promise.all([
      AdminApi.listUsers(),
      AdminApi.listAccessRequests('pending').catch(() => ({ requests: [] })),
      AdminApi.listRoles().catch(() => ({ roles: [] })),
    ])
    setPeople((userData.users as Person[]) || [])
    const requests = requestData as { requests?: RequestRow[]; access_requests?: RequestRow[] }
    setRequests(requests.requests || requests.access_requests || [])
    setRoles((roleData.roles as Role[]) || [])
  }

  useEffect(() => {
    reload().catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Could not load people')).finally(() => setLoading(false))
  }, [])

  if (loading) return <Loader size="md" title="Opening Admin" subtitle="Loading your data" />

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Access requests</h2>
        <ul className="space-y-3 text-sm">
          {requests.length === 0 ? <li className="text-zinc-500">No pending requests.</li> : null}
          {requests.map((row) => (
            <RequestItem key={row.id} row={row} roles={roles} onDone={reload} onMessage={setMessage} />
          ))}
        </ul>
      </section>
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Users</h2>
          <SlideTextButton type="button" text="New user" hoverText="Create user" onClick={() => setCreating(true)} />
        </div>
        <SmoothDrawer
          open={creating}
          title="New user"
          description="Username, display name, and role"
          onClose={() => setCreating(false)}
        >
          <CreateUser
            roles={roles}
            onDone={async () => {
              setCreating(false)
              await reload()
            }}
            onMessage={setMessage}
            onCancel={() => setCreating(false)}
          />
        </SmoothDrawer>
        <ul className="space-y-2 text-sm text-[var(--ink)]">
          {people.map((person) => (
            <li key={person.id} className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-transparent px-3 py-2 text-[var(--ink)] dark:border-zinc-800">
              <span>{person.display_name || person.username} · {person.role_name}</span>
              <button type="button" className="text-rose-600 dark:text-rose-300" onClick={() => { void AdminApi.deleteUser(person.id).then(reload).catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Delete failed')) }}>Delete</button>
            </li>
          ))}
        </ul>
      </section>
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  )
}

function CreateUser({ roles, onDone, onMessage, onCancel }: { roles: Role[]; onDone: () => Promise<void>; onMessage: (text: string) => void; onCancel: () => void }) {
  return (
    <form
      className="grid gap-2"
      onSubmit={async (event) => {
        event.preventDefault()
        const form = new FormData(event.currentTarget)
        try {
          await AdminApi.createUser({
            username: String(form.get('username') || '').trim(),
            display_name: String(form.get('display_name') || '').trim(),
            password: String(form.get('password') || ''),
            role_id: Number(form.get('role_id')),
            telecaller_name: String(form.get('telecaller_name') || '').trim(),
          })
          event.currentTarget.reset()
          onMessage('User saved')
          await onDone()
        } catch (err) {
          onMessage(err instanceof Error ? err.message : 'Could not create user')
        }
      }}
    >
      <input name="username" required placeholder="Username" className={inputClass} />
      <input name="display_name" placeholder="Display name" className={inputClass} />
      <input name="password" required type="password" placeholder="Temporary password" className={inputClass} />
      <input name="telecaller_name" placeholder="Telecaller name" className={inputClass} />
      <select name="role_id" className={inputClass}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
      <div className="flex gap-2">
        <SlideTextButton type="submit" text="Save" hoverText="Create user" />
        <SlideTextButton type="button" variant="ghost" text="Cancel" hoverText="Close" onClick={onCancel} />
      </div>
    </form>
  )
}

function RequestItem({ row, roles, onDone, onMessage }: { row: RequestRow; roles: Role[]; onDone: () => Promise<void>; onMessage: (text: string) => void }) {
  return (
    <li className="rounded-2xl border border-zinc-200 bg-transparent p-3 text-[var(--ink)] dark:border-zinc-800">
      <p className="font-medium text-[var(--ink)]">{row.full_name || row.requested_username}</p>
      <p className="text-zinc-500">{row.preferred_module} · {row.reason}</p>
      <form
        className="mt-2 grid gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          try {
            await AdminApi.approveRequest(row.id, {
              username: String(form.get('username') || '').trim(),
              display_name: String(form.get('display_name') || '').trim(),
              password: String(form.get('password') || ''),
              role_id: Number(form.get('role_id')),
              telecaller_name: String(form.get('telecaller_name') || '').trim(),
              review_note: String(form.get('review_note') || '').trim(),
            })
            onMessage('User created')
            await onDone()
          } catch (err) {
            onMessage(err instanceof Error ? err.message : 'Approve failed')
          }
        }}
      >
        <input name="username" defaultValue={row.requested_username || ''} className={inputClass} />
        <input name="display_name" defaultValue={row.full_name || ''} className={inputClass} />
        <input name="password" type="password" required placeholder="Password" className={inputClass} />
        <input name="telecaller_name" placeholder="Telecaller name" className={inputClass} />
        <input name="review_note" placeholder="Note" className={inputClass} />
        <select name="role_id" className={inputClass}>{roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select>
        <div className="flex gap-2">
          <SlideTextButton type="submit" text="Save" hoverText="Approve" />
          <SlideTextButton
            type="button"
            variant="ghost"
            text="Cancel"
            hoverText="Deny"
            onClick={() => {
              void AdminApi.denyRequest(row.id, { review_note: 'Denied' })
                .then(onDone)
                .catch((err: unknown) => onMessage(err instanceof Error ? err.message : 'Deny failed'))
            }}
          />
        </div>
      </form>
    </li>
  )
}

function RolesView() {
  const [roles, setRoles] = useState<Role[]>([])
  const [catalog, setCatalog] = useState<Perm[]>([])
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [rank, setRank] = useState('10')
  const [draft, setDraft] = useState<string[]>([])
  const [editing, setEditing] = useState<number | null>(null)

  async function reload() {
    const data = await AdminApi.listRoles()
    setRoles((data.roles as Role[]) || [])
    setCatalog((data.permission_catalog as Perm[]) || [])
  }

  useEffect(() => { reload().catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Could not load roles')) }, [])

  const groups = catalog.reduce<Record<string, Perm[]>>((acc, item) => {
    (acc[item.group] ||= []).push(item)
    return acc
  }, {})

  function togglePerm(id: string) {
    setDraft((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  return (
    <div className="space-y-4">
      <ul className="space-y-2 text-sm text-[var(--ink)]">
        {roles.map((role) => (
          <li key={role.id} className="flex items-center justify-between rounded-2xl border border-zinc-200 bg-transparent px-3 py-2 text-[var(--ink)] dark:border-zinc-800">
            <button type="button" className="text-left text-[var(--ink)]" onClick={() => { setEditing(role.id); setName(role.name); setRank(String(role.rank ?? 0)); setDraft(role.permissions || []) }}>
              <span className="font-medium">{role.name}</span>
              <span className="ml-2 text-[var(--muted)]">rank {role.rank ?? 0}</span>
            </button>
            {role.is_system ? null : (
              <button type="button" className="text-rose-600 dark:text-rose-300" onClick={() => { void AdminApi.deleteRole(role.id).then(reload).catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Delete failed')) }}>Delete</button>
            )}
          </li>
        ))}
      </ul>
      <form
        className="grid max-w-3xl gap-3"
        onSubmit={async (event) => {
          event.preventDefault()
          const body = { name, rank: Number(rank), permissions: draft }
          try {
            if (editing) await AdminApi.updateRole(editing, body)
            else await AdminApi.createRole(body)
            setName('')
            setDraft([])
            setEditing(null)
            setMessage('Role saved')
            await reload()
          } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Could not save role')
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Role name" className={inputClass} />
        <input value={rank} onChange={(e) => setRank(e.target.value)} placeholder="Rank" className={inputClass} />
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(groups).map(([group, items]) => (
            <fieldset key={group} className="space-y-1 rounded-2xl border border-zinc-200 p-3 text-[var(--ink)] dark:border-zinc-800">
              <legend className="px-1 text-xs font-semibold text-[var(--ink)]">{group}</legend>
              {items.map((item) => (
                <label key={item.id} className="flex items-center gap-2 text-sm text-[var(--ink)]">
                  <input type="checkbox" checked={draft.includes(item.id)} onChange={() => togglePerm(item.id)} />
                  {item.label}
                </label>
              ))}
            </fieldset>
          ))}
        </div>
        <SlideTextButton type="submit" text="Save" hoverText={editing ? 'Update role' : 'Create role'} />
      </form>
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  )
}
