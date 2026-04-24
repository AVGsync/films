import { useEffect, useState } from 'react'
import { api, apiDelete } from '../api'
import { useStore } from '../store'
import { FilmCard, SkeletonCard } from '../components/FilmCard'
import { type Film, type LibraryType } from '../types'

interface Props {
  onFilmClick: (kpId: number) => void
  onBack: () => void
}

// Deduplicate by kpId — history may have multiple entries per film (different providers)
function dedup(items: Film[]): Film[] {
  const seen = new Map<number, Film>()
  for (const f of items) {
    if (!seen.has(f.kpId)) seen.set(f.kpId, f)
  }
  return Array.from(seen.values())
}

export function LibraryView({ onFilmClick, onBack }: Props) {
  const { state, dispatch } = useStore()
  const [items, setItems] = useState<Film[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    load(state.libraryType)
  }, [state.libraryType, state.user]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load(type: LibraryType) {
    if (!state.user) return
    setLoading(true)
    setError('')
    try {
      const data = await api(`/api/library/${type}`)
      setItems(dedup((data.items as Film[]) || []))
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setLoading(false)
    }
  }

  async function removeFav(e: React.MouseEvent, kpId: number) {
    e.stopPropagation()
    try {
      await apiDelete(`/api/library/favorites?kp=${encodeURIComponent(kpId)}`)
      setItems(prev => prev.filter(f => f.kpId !== kpId))
    } catch {}
  }

  async function clearHistory() {
    try {
      await apiDelete('/api/library/history')
      setItems([])
    } catch {}
  }

  const type = state.libraryType

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
          <button
            className={`tab${type === 'favorites' ? ' active' : ''}`}
            onClick={() => dispatch({ type: 'SET_LIBRARY_TYPE', libraryType: 'favorites' })}
          >
            Избранное
          </button>
          <button
            className={`tab${type === 'history' ? ' active' : ''}`}
            onClick={() => dispatch({ type: 'SET_LIBRARY_TYPE', libraryType: 'history' })}
          >
            История
          </button>
        </div>
        {type === 'history' && items.length > 0 && (
          <button className="btn btn-danger" onClick={clearHistory}>Очистить</button>
        )}
      </div>

      {!state.user ? (
        <div className="state-box">
          <strong>Нужен вход</strong>
          Личная {type === 'favorites' ? 'подборка' : 'история'} доступна после авторизации
        </div>
      ) : error ? (
        <div className="state-box"><strong>Ошибка</strong>{error}</div>
      ) : loading ? (
        <div className="grid">
          {Array.from({ length: 8 }, (_, i) => <SkeletonCard key={i} />)}
        </div>
      ) : items.length === 0 ? (
        <div className="state-box">
          <strong>{type === 'favorites' ? 'Избранное пусто' : 'История пуста'}</strong>
          Откройте фильм и загрузите плеер
        </div>
      ) : (
        <div className="grid">
          {items.map(film => (
            <FilmCard
              key={film.kpId}
              film={film}
              onClick={() => onFilmClick(film.kpId)}
              showRemove={type === 'favorites'}
              onRemove={e => removeFav(e, film.kpId)}
            />
          ))}
        </div>
      )}
    </main>
  )
}
