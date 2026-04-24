import { useStore } from '../store'
import { setToken } from '../api'
import { type LibraryType } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onGoLibrary: (t: LibraryType) => void
}

export function ProfileModal({ open, onClose, onGoLibrary }: Props) {
  const { state, dispatch } = useStore()

  function logout() {
    localStorage.removeItem('cinema.jwt')
    setToken('')
    dispatch({ type: 'SET_TOKEN', token: '' })
    dispatch({ type: 'SET_USER', user: null })
    onClose()
    dispatch({ type: 'SET_VIEW', view: 'home' })
  }

  if (!state.user) return null

  return (
    <div className={`modal-backdrop${open ? ' active' : ''}`} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">Личный кабинет</div>
          <button className="btn btn-icon" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="profile-list">
          <div className="profile-row"><span>Логин</span><strong>{state.user.login}</strong></div>
          <div className="profile-row"><span>Email</span><strong>{state.user.email}</strong></div>
          <div className="profile-row"><span>Роль</span><strong>{state.user.role}</strong></div>
        </div>
        <div className="card-actions" style={{ marginTop: 0 }}>
          <button onClick={() => { onGoLibrary('favorites'); onClose() }}>Избранное</button>
          <button onClick={() => { onGoLibrary('history'); onClose() }}>История</button>
          <button onClick={logout} style={{ color: 'var(--accent-red)' }}>Выйти</button>
        </div>
      </div>
    </div>
  )
}
