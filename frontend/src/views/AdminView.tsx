import { useEffect, useState } from 'react'
import { api, apiJSON } from '../api'
import { useStore } from '../store'
import { type AdminTab } from '../types'

interface Stats { users: number; admins: number; favorites: number; history: number; providers: number }
interface UserRow { id: number; login: string; email: string; role: string; createdAt: string }
interface LibItem { login: string; kpId: number; title: string; provider: string; timestamp: string }

interface Props {
  onBack: () => void
}

export function AdminView({ onBack }: Props) {
  const { state, dispatch } = useStore()
  const tab = state.adminTab

  function setTab(t: AdminTab) { dispatch({ type: 'SET_ADMIN_TAB', adminTab: t }) }

  return (
    <main>
      <button className="back-btn" onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Назад
      </button>

      <div className="library-toolbar">
        <div className="section-tabs">
          {(['overview', 'users', 'favorites', 'history', 'players'] as AdminTab[]).map(t => (
            <button key={t} className={`tab${tab === t ? ' active' : ''}`} onClick={() => setTab(t)}>
              {{ overview: 'Обзор', users: 'Пользователи', favorites: 'Избранное', history: 'История', players: 'Плееры' }[t]}
            </button>
          ))}
        </div>
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'players' && <PlayersTab />}
      {(tab === 'favorites' || tab === 'history') && <LibTab type={tab} />}
    </main>
  )
}

function OverviewTab() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api('/api/admin/stats').then(d => setStats(d as unknown as Stats)).catch(e => setError(e.message))
  }, [])
  if (error) return <div className="state-box"><strong>Ошибка</strong>{error}</div>
  if (!stats) return <div className="state-box"><strong>Загрузка</strong></div>
  return (
    <div className="admin-grid">
      {([['Пользователи', stats.users], ['Админы', stats.admins], ['Избранное', stats.favorites], ['История', stats.history], ['Плееры', stats.providers]] as [string, number][]).map(([label, val]) => (
        <div key={label} className="stat-card">
          <strong>{val ?? 0}</strong>
          <span>{label}</span>
        </div>
      ))}
    </div>
  )
}

function UsersTab() {
  const { state } = useStore()
  const [users, setUsers] = useState<UserRow[]>([])
  const [error, setError] = useState('')

  async function load() {
    try {
      const d = await api('/api/admin/users')
      setUsers((d.items as UserRow[]) || [])
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    }
  }
  useEffect(() => { load() }, [])

  async function changeRole(id: number, role: string) {
    try { await apiJSON(`/api/admin/users/${id}`, { role }, 'PATCH') }
    catch (e: unknown) { alert(e instanceof Error ? e.message : 'Ошибка'); load() }
  }

  async function deleteUser(id: number) {
    if (!confirm('Удалить пользователя?')) return
    try {
      await fetch(`/api/admin/users/${id}`, {
        method: 'DELETE',
        headers: state.token ? { Authorization: 'Bearer ' + state.token } : {},
      })
      load()
    } catch {}
  }

  if (error) return <div className="state-box"><strong>Ошибка</strong>{error}</div>
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Логин</th><th>Email</th><th>Роль</th><th>Создан</th><th></th></tr></thead>
        <tbody>
          {users.length === 0
            ? <tr><td colSpan={6}>Нет пользователей</td></tr>
            : users.map(u => (
              <tr key={u.id}>
                <td>{u.id}</td>
                <td>{u.login}</td>
                <td>{u.email || ''}</td>
                <td>
                  <select value={u.role} onChange={e => changeRole(u.id, e.target.value)}>
                    <option value="user">user</option>
                    <option value="admin">admin</option>
                  </select>
                </td>
                <td>{u.createdAt ? new Date(u.createdAt).toLocaleString('ru-RU') : ''}</td>
                <td>
                  <button className="btn btn-danger" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => deleteUser(u.id)}>
                    Удалить
                  </button>
                </td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  )
}

function LibTab({ type }: { type: 'favorites' | 'history' }) {
  const { state } = useStore()
  const [items, setItems] = useState<LibItem[]>([])
  const [error, setError] = useState('')
  useEffect(() => {
    api(`/api/admin/library?type=${encodeURIComponent(type)}&limit=100`)
      .then(d => setItems((d.items as LibItem[]) || []))
      .catch(e => setError(e.message))
  }, [type])
  const provName = (id: string) => (state.providers.find(p => p.id === id) || {}).label || id || ''
  if (error) return <div className="state-box"><strong>Ошибка</strong>{error}</div>
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Логин</th><th>KP</th><th>Название</th><th>Плеер</th><th>Дата</th></tr></thead>
        <tbody>
          {items.length === 0
            ? <tr><td colSpan={5}>Нет данных</td></tr>
            : items.map((item, i) => (
              <tr key={i}>
                <td>{item.login}</td>
                <td>{item.kpId}</td>
                <td>{item.title}</td>
                <td>{provName(item.provider)}</td>
                <td>{item.timestamp ? new Date(item.timestamp).toLocaleString('ru-RU') : ''}</td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  )
}

function PlayersTab() {
  const { state } = useStore()
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>ID</th><th>Название</th><th>Тип</th></tr></thead>
        <tbody>
          {state.providers.map(p => (
            <tr key={p.id}>
              <td>{p.id}</td>
              <td>{p.label}</td>
              <td>{p.async ? 'API resolve' : 'iframe'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
