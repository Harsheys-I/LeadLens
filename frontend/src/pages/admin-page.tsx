import { useEffect, useState } from 'react'
import { Shield, UserPlus, Users } from 'lucide-react'
import Loader from '@/components/ui/loader.tsx'
import SlideTextButton from '@/components/ui/slide-text-button.tsx'
import SmoothTab, { type TabItem } from '@/components/ui/smooth-tab.tsx'
import SpotlightCards from '@/components/ui/spotlight-cards.tsx'
import { ModuleFrame } from '@/components/shell/module-frame.tsx'
import { ModuleGuard } from '@/components/shell/guard.tsx'
import { AdminApi } from '@/lib/api.ts'
import { useAuth } from '@/lib/auth.tsx'
import { useView } from '@/lib/use-view.ts'

type Role = { id: number; name: string; rank?: number; role_key?: string; permissions?: string[] }
type Person = { id: number; username: string; display_name?: string; role_name?: string; role_id?: number; telecaller_name?: string; role_key?: string }
type RequestRow = { id: number; full_name?: string; requested_username?: string; preferred_module?: string; reason?: string }

const inputClass = 'w-full rounded-xl border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950'

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
    <ModuleGuard allow={(person) => Boolean(person.is_super || hasPermission('module.admin'))}>
      <ModuleFrame eyebrow="Admin" items={items} activeId={view} onChange={select} onSettings={() => select(allowed.includes('roles') ? 'roles' : 'users')}>
        {view === 'users' ? <UsersView /> : null}
        {view === 'roles' ? <RolesView /> : null}
      </ModuleFrame>
    </ModuleGuard>
  )
}

function UsersView() {
  const [people, setPeople] = useState<Person[]>([])
  const [requests, setRequests] = useState<RequestRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [loading, setLoading] = useState(true)
  const [message, setMessage] = useState('')

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

  if (loading) return <Loader size="lg" title="Admin" subtitle="Loading people" />

  const tabs: TabItem[] = [
    {
      id: 'people',
      title: 'People',
      color: 'bg-zinc-900 dark:bg-white',
      cardContent: (
        <div className="h-full space-y-3 overflow-auto p-4">
          <SpotlightCards
            eyebrow="Directory"
            heading={`${people.length} people`}
            items={[
              { icon: Users, title: 'Users', description: `${people.length} accounts`, color: '#04C7DD' },
              { icon: UserPlus, title: 'Requests', description: `${requests.length} waiting`, color: '#FF2D55' },
              { icon: Shield, title: 'Roles', description: `${roles.length} roles`, color: '#A3F900' },
            ]}
          />
          <ul className="space-y-2 text-sm">
            {people.map((person) => (
              <li key={person.id} className="flex items-center justify-between gap-2">
                <span>{person.display_name || person.username} · {person.role_name}</span>
                <button type="button" className="text-rose-600" onClick={() => { void AdminApi.deleteUser(person.id).then(reload).catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Delete failed')) }}>Delete</button>
              </li>
            ))}
          </ul>
          <CreateUser roles={roles} onDone={reload} onMessage={setMessage} />
        </div>
      ),
    },
    {
      id: 'requests',
      title: 'Access requests',
      color: 'bg-rose-500',
      cardContent: (
        <ul className="h-full space-y-3 overflow-auto p-4 text-sm">
          {requests.length === 0 ? <li>No pending requests.</li> : null}
          {requests.map((row) => (
            <RequestItem key={row.id} row={row} roles={roles} onDone={reload} onMessage={setMessage} />
          ))}
        </ul>
      ),
    },
  ]

  return (
    <div className="space-y-3">
      <SmoothTab items={tabs} className="w-full max-w-none" stageClassName="h-[36rem]" />
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  )
}

function CreateUser({ roles, onDone, onMessage }: { roles: Role[]; onDone: () => Promise<void>; onMessage: (text: string) => void }) {
  return (
    <form
      className="grid gap-2 border-t border-zinc-200 pt-3 dark:border-zinc-800"
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
      <SlideTextButton type="submit" text="Save" hoverText="Create user" />
    </form>
  )
}

function RequestItem({ row, roles, onDone, onMessage }: { row: RequestRow; roles: Role[]; onDone: () => Promise<void>; onMessage: (text: string) => void }) {
  return (
    <li className="rounded-2xl border border-zinc-200 p-3 dark:border-zinc-800">
      <p className="font-medium">{row.full_name || row.requested_username}</p>
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
  const [message, setMessage] = useState('')
  const [name, setName] = useState('')
  const [rank, setRank] = useState('10')

  async function reload() {
    const data = await AdminApi.listRoles()
    setRoles((data.roles as Role[]) || [])
  }

  useEffect(() => { reload().catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Could not load roles')) }, [])

  return (
    <div className="space-y-4">
      <ul className="space-y-2 text-sm">
        {roles.map((role) => (
          <li key={role.id} className="flex items-center justify-between rounded-2xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span>{role.name} · rank {role.rank ?? 0}</span>
            <button type="button" className="text-rose-600" onClick={() => { void AdminApi.deleteRole(role.id).then(reload).catch((err: unknown) => setMessage(err instanceof Error ? err.message : 'Delete failed')) }}>Delete</button>
          </li>
        ))}
      </ul>
      <form
        className="grid max-w-md gap-2"
        onSubmit={async (event) => {
          event.preventDefault()
          try {
            await AdminApi.createRole({ name, rank: Number(rank), permissions: [] })
            setName('')
            setMessage('Role saved')
            await reload()
          } catch (err) {
            setMessage(err instanceof Error ? err.message : 'Could not save role')
          }
        }}
      >
        <input value={name} onChange={(e) => setName(e.target.value)} required placeholder="Role name" className={inputClass} />
        <input value={rank} onChange={(e) => setRank(e.target.value)} placeholder="Rank" className={inputClass} />
        <SlideTextButton type="submit" text="Save" hoverText="Create role" />
      </form>
      {message ? <p className="text-sm">{message}</p> : null}
    </div>
  )
}
