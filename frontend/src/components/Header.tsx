import { useRef, useEffect } from 'react'
import { useStore } from '../store'
import { type LibraryType } from '../types'

interface Props {
  onSearch: (q: string) => void
  onGoHome: () => void
  onGoLibrary: (t: LibraryType) => void
  onGoAdmin: () => void
  onShowAuth: () => void
  onShowProfile: () => void
  searchQuery: string
}

export function Header({ onSearch, onGoHome, onGoLibrary, onGoAdmin, onShowAuth, onShowProfile, searchQuery }: Props) {
  const { state } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (inputRef.current && inputRef.current.value !== searchQuery) {
      inputRef.current.value = searchQuery
    }
  }, [searchQuery])

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value.trim()
    if (timerRef.current) clearTimeout(timerRef.current)
    if (!q) { onSearch(''); return }
    timerRef.current = setTimeout(() => onSearch(q), 400)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      if (timerRef.current) clearTimeout(timerRef.current)
      const q = (e.target as HTMLInputElement).value.trim()
      if (q) onSearch(q)
    }
    if (e.key === 'Escape') {
      ;(e.target as HTMLInputElement).value = ''
      onSearch('')
    }
  }

  return (
    <header className="header">
      <div className="brand" onClick={onGoHome}>
        <div className="brand-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <rect x="2" y="4" width="20" height="16" rx="4" stroke="#fff" strokeWidth="1.5"/>
            <path d="M10 8.5l5.5 3.5-5.5 3.5V8.5z" fill="#fff"/>
          </svg>
        </div>
        <span>Cinema</span>
      </div>

      <div className="search-wrap">
        <svg className="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none">
          <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="2"/>
          <path d="M16 16l4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          placeholder="Название, жанр, год..."
          autoComplete="off"
          onChange={handleInput}
          onKeyDown={handleKeyDown}
        />
      </div>

      <div className="header-actions">
        <button className="btn btn-icon" title="Избранное" onClick={() => onGoLibrary('favorites')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M12 21s-7-4.6-9.4-9.1C.6 8.1 2.9 4 7 4c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 4.1 0 6.4 4.1 4.4 7.9C19 16.4 12 21 12 21z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/>
          </svg>
        </button>
        <button className="btn btn-icon" title="История" onClick={() => onGoLibrary('history')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M3 12a9 9 0 1 0 3-6.7M3 4v5h5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M12 7v5l3 2" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
          </svg>
        </button>
        {state.user?.role === 'admin' && (
          <button className="btn btn-glass" onClick={onGoAdmin}>Админ</button>
        )}
        {state.user ? (
          <button className="btn btn-glass user-chip" onClick={onShowProfile} title="Личный кабинет">
            {state.user.login}
          </button>
        ) : (
          <button className="btn btn-glass" onClick={onShowAuth}>Войти</button>
        )}
      </div>
    </header>
  )
}
