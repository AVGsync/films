import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { FilmCard, SkeletonCard } from '../components/FilmCard'
import { type Film, type Genre, type AppState } from '../types'

const COLLECTIONS = [
  { type: 'TOP_POPULAR_ALL', label: 'Популярное', order: 'NUM_VOTE' },
  { type: 'TOP_250_MOVIES', label: 'Топ 250 фильмов', order: 'RATING', filmType: 'FILM' },
  { type: 'TOP_250_TV_SHOWS', label: 'Топ 250 сериалов', order: 'RATING', filmType: 'TV_SERIES' },
  { type: 'POPULAR_SERIES', label: 'Популярные сериалы', order: 'NUM_VOTE', filmType: 'TV_SERIES' },
  { type: 'FAMILY', label: 'Семейное', order: 'NUM_VOTE', genreNames: ['семейный', 'семейное'] },
  { type: 'COMICS_THEME', label: 'Комиксы', order: 'NUM_VOTE' },
]

const TYPES = [
  { val: '', label: 'Любой тип' },
  { val: 'FILM', label: 'Фильм' },
  { val: 'TV_SERIES', label: 'Сериал' },
  { val: 'TV_SHOW', label: 'ТВ-шоу' },
  { val: 'MINI_SERIES', label: 'Мини-сериал' },
]

const ORDERS = [
  { val: 'RATING', label: 'По рейтингу' },
  { val: 'NUM_VOTE', label: 'По голосам' },
  { val: 'YEAR', label: 'По году' },
]

function genreIDByNames(genres: Genre[], names: string[]): string {
  const set = names.map(v => v.toLowerCase())
  const found = genres.find(g => set.includes(String(g.genre || '').toLowerCase()))
  return found ? String(found.id) : ''
}

function buildParams(s: AppState, page: number): URLSearchParams {
  const coll = COLLECTIONS.find(c => c.type === s.collection) || {} as typeof COLLECTIONS[0]
  const filtersActive = Boolean(s.filters.genre || s.filters.type || s.filters.yearFrom || s.filters.yearTo || s.filters.order !== 'RATING')
  const params = new URLSearchParams()
  params.set('page', String(page))
  const order = s.filters.order !== 'RATING' ? s.filters.order : ((coll as { order?: string }).order || 'RATING')
  params.set('order', order)
  const filmType = s.filters.type || (coll as { filmType?: string }).filmType || ''
  if (filmType) params.set('type', filmType)
  const genre = s.filters.genre || genreIDByNames(s.genres, (coll as { genreNames?: string[] }).genreNames || [])
  if (genre) params.set('genres', genre)
  if (s.filters.yearFrom) params.set('yearFrom', s.filters.yearFrom)
  if (s.filters.yearTo) params.set('yearTo', s.filters.yearTo)
  return Object.assign(params, { _filtersActive: filtersActive })
}

interface Props {
  onFilmClick: (kpId: number) => void
}

export function HomeView({ onFilmClick }: Props) {
  const { state, dispatch } = useStore()
  const stateRef = useRef(state)
  stateRef.current = state
  const loadingRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Stable fetch — reads state from ref, never stale
  const doFetch = useRef(async (page: number, append: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true
    dispatch({ type: 'SET_LOADING', loading: true })
    const s = stateRef.current
    const filtersActive = Boolean(s.filters.genre || s.filters.type || s.filters.yearFrom || s.filters.yearTo || s.filters.order !== 'RATING')
    try {
      let items: Film[] = []
      let hasMore = false
      if (filtersActive) {
        const params = buildParams(s, page)
        const data = await api('/api/films?' + params.toString())
        items = (data.items as Film[]) || []
        const totalPages = (data.totalPages as number) || 1
        dispatch({ type: 'SET_TOTAL_PAGES', totalPages })
        hasMore = page < totalPages && items.length > 0
      } else {
        const data = await api(`/api/collections?type=${encodeURIComponent(s.collection)}&page=${page}`)
        items = (data.items as Film[]) || []
        hasMore = items.length >= 20
      }
      if (append) dispatch({ type: 'APPEND_ITEMS', items })
      else dispatch({ type: 'SET_ITEMS', items })
      dispatch({ type: 'SET_HAS_MORE', hasMore })
    } catch {
      dispatch({ type: 'SET_HAS_MORE', hasMore: false })
    } finally {
      loadingRef.current = false
      dispatch({ type: 'SET_LOADING', loading: false })
    }
  })

  // Reset + refetch when collection or filters change (stable keys)
  const collKey = state.collection
  const filterKey = `${state.filters.genre}|${state.filters.type}|${state.filters.order}|${state.filters.yearFrom}|${state.filters.yearTo}`

  useEffect(() => {
    dispatch({ type: 'SET_ITEMS', items: [] })
    dispatch({ type: 'SET_PAGE', page: 1 })
    dispatch({ type: 'SET_HAS_MORE', hasMore: true })
    doFetch.current(1, false)
  }, [collKey, filterKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stable observer — created once, reads stateRef
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      const s = stateRef.current
      if (loadingRef.current || !s.hasMore) return
      const nextPage = s.page + 1
      dispatch({ type: 'SET_PAGE', page: nextPage })
      doFetch.current(nextPage, true)
    }, { rootMargin: '500px 0px' })
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isLoading = state.loading && state.items.length === 0

  return (
    <main>
      <div className="tabs-wrap">
        {COLLECTIONS.map(c => (
          <button
            key={c.type}
            className={`tab${state.collection === c.type ? ' active' : ''}`}
            onClick={() => dispatch({ type: 'SET_COLLECTION', collection: c.type })}
          >
            {c.label}
          </button>
        ))}
      </div>

      <FilterBar
        filters={state.filters}
        genres={state.genres}
        onFilterChange={f => dispatch({ type: 'SET_FILTERS', filters: f })}
        onApply={() => {
          dispatch({ type: 'SET_ITEMS', items: [] })
          dispatch({ type: 'SET_PAGE', page: 1 })
          doFetch.current(1, false)
        }}
        onReset={() => dispatch({ type: 'RESET_FILTERS' })}
      />

      <div className="grid">
        {isLoading
          ? Array.from({ length: 12 }, (_, i) => <SkeletonCard key={i} />)
          : state.items.map(film => (
            <FilmCard key={film.kpId} film={film} onClick={() => onFilmClick(film.kpId)} />
          ))
        }
        {!isLoading && state.items.length === 0 && !state.loading && (
          <div className="state-box"><strong>Ничего не найдено</strong></div>
        )}
      </div>

      <div className="scroll-sentinel" ref={sentinelRef}>
        {state.loading && state.items.length > 0 && 'Загрузка...'}
        {!state.hasMore && state.items.length > 0 && 'Загружено всё'}
      </div>
    </main>
  )
}

function FilterBar({
  filters, genres, onFilterChange, onApply, onReset,
}: {
  filters: { genre: string; type: string; order: string; yearFrom: string; yearTo: string }
  genres: Genre[]
  onFilterChange: (f: Partial<typeof filters>) => void
  onApply: () => void
  onReset: () => void
}) {
  return (
    <div className="filter-bar">
      <select value={filters.genre} onChange={e => onFilterChange({ genre: e.target.value })}>
        <option value="">Жанр</option>
        {genres.map(g => <option key={g.id} value={String(g.id)}>{g.genre}</option>)}
      </select>
      <select value={filters.type} onChange={e => onFilterChange({ type: e.target.value })}>
        {TYPES.map(t => <option key={t.val} value={t.val}>{t.label}</option>)}
      </select>
      <select value={filters.order} onChange={e => onFilterChange({ order: e.target.value })}>
        {ORDERS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
      </select>
      <label>Год от</label>
      <input type="number" placeholder="1990" min="1900" max="2035" value={filters.yearFrom}
        onChange={e => onFilterChange({ yearFrom: e.target.value })} />
      <label>до</label>
      <input type="number" placeholder="2026" min="1900" max="2035" value={filters.yearTo}
        onChange={e => onFilterChange({ yearTo: e.target.value })} />
      <button className="btn btn-glass active" onClick={onApply}>Применить</button>
      <button className="btn btn-glass" onClick={onReset}>Сбросить</button>
    </div>
  )
}
