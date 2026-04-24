import { useState, useEffect } from 'react'
import { apiJSON, setToken } from '../api'
import { useStore } from '../store'

interface Props {
  open: boolean
  mode: 'login' | 'register'
  onClose: () => void
  onModeChange: (m: 'login' | 'register') => void
}

export function AuthModal({ open, mode, onClose, onModeChange }: Props) {
  const { dispatch } = useStore()
  const [login, setLogin] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (open) { setError(''); setLogin(''); setEmail(''); setPassword('') }
  }, [open, mode])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const body = mode === 'register' ? { login, email, password } : { email, password }
      const data = await apiJSON(`/api/auth/${mode}`, body)
      const token = (data.token as string) || ''
      const user = data.user as { id: number; login: string; email: string; role: string }
      if (token) {
        localStorage.setItem('cinema.jwt', token)
        setToken(token)
      }
      dispatch({ type: 'SET_TOKEN', token })
      dispatch({ type: 'SET_USER', user })
      onClose()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={`modal-backdrop${open ? ' active' : ''}`} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <div className="modal-head">
          <div className="modal-title">{mode === 'login' ? 'Вход' : 'Регистрация'}</div>
          <button className="btn btn-icon" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="section-tabs">
          <button className={`tab${mode === 'login' ? ' active' : ''}`} onClick={() => onModeChange('login')}>Вход</button>
          <button className={`tab${mode === 'register' ? ' active' : ''}`} onClick={() => onModeChange('register')}>Регистрация</button>
        </div>
        <form className="form-grid" onSubmit={submit}>
          {mode === 'register' && (
            <input
              placeholder="Логин"
              autoComplete="username"
              value={login}
              onChange={e => setLogin(e.target.value)}
              required
            />
          )}
          <input
            type="email"
            placeholder="Email"
            autoComplete="email"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Пароль"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
          />
          <div className="form-error">{error}</div>
          <button className="btn btn-primary" type="submit" disabled={loading}>
            {loading ? 'Загрузка...' : mode === 'login' ? 'Войти' : 'Создать аккаунт'}
          </button>
        </form>
      </div>
    </div>
  )
}
