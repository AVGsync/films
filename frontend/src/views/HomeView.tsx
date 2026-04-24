import { useEffect, useRef, useState, memo } from 'react'
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
  return params
}

// Memoised grid — only re-renders when items array reference changes
const FilmGrid = memo(({ items, onFilmClick }: { items: Film[]; onFilmClick: (id: number) => void }) => (
  <>
    {items.map(film => (
      <FilmCard key={film.kpId} film={film} onClick={() => onFilmClick(film.kpId)} />
    ))}
  </>
))

interface Props {
  onFilmClick: (kpId: number) => void
}

export function HomeView({ onFilmClick }: Props) {
  const { state, dispatch } = useStore()
  const stateRef = useRef(state)
  stateRef.current = state

  const loadingRef = useRef(false)
  const hasMoreRef = useRef(true)   // sync hasMore, avoids stale state reads
  const pageRef = useRef(1)         // sync page, avoids stale state reads
  const sentinelRef = useRef<HTMLDivElement>(null)
  const observerRef = useRef<IntersectionObserver | null>(null)

  // resetKey: incremented on every tab click (even same tab) → forces re-fetch
  const [resetKey, setResetKey] = useState(0)

  const filtersActive = Boolean(
    state.filters.genre || state.filters.type || state.filters.yearFrom ||
    state.filters.yearTo || state.filters.order !== 'RATING'
  )
  const collKey = state.collection
  const filterKey = `${state.filters.genre}|${state.filters.type}|${state.filters.order}|${state.filters.yearFrom}|${state.filters.yearTo}`

  // Stable fetch fn stored in ref — reads from stateRef, never stale
  const doFetch = useRef(async (page: number, append: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true
    pageRef.current = page
    dispatch({ type: 'SET_LOADING', loading: true })
    const s = stateRef.current
    const useFilters = Boolean(s.filters.genre || s.filters.type || s.filters.yearFrom || s.filters.yearTo || s.filters.order !== 'RATING')
    let localHasMore = false
    try {
      let items: Film[] = []
      if (useFilters) {
        const data = await api('/api/films?' + buildParams(s, page).toString())
        items = (data.items as Film[]) || []
        const totalPages = (data.totalPages as number) || 1
        dispatch({ type: 'SET_TOTAL_PAGES', totalPages })
        localHasMore = page < totalPages && items.length > 0
      } else {
        const data = await api(`/api/collections?type=${encodeURIComponent(s.collection)}&page=${page}`)
        items = (data.items as Film[]) || []
        localHasMore = items.length >= 20
      }
      if (append) dispatch({ type: 'APPEND_ITEMS', items })
      else dispatch({ type: 'SET_ITEMS', items })
      hasMoreRef.current = localHasMore
      dispatch({ type: 'SET_HAS_MORE', hasMore: localHasMore })
    } catch {
      hasMoreRef.current = false
      dispatch({ type: 'SET_HAS_MORE', hasMore: false })
    } finally {
      loadingRef.current = false
      dispatch({ type: 'SET_LOADING', loading: false })
      // Re-observe sentinel: forces IntersectionObserver to re-evaluate.
      // Critical on large screens where sentinel never leaves viewport.
      if (localHasMore) {
        requestAnimationFrame(() => {
          const obs = observerRef.current
          const el = sentinelRef.current
          if (obs && el) { obs.unobserve(el); obs.observe(el) }
        })
      }
    }
  })

  // Reset + refetch on collection/filter/resetKey change
  useEffect(() => {
    hasMoreRef.current = true
    pageRef.current = 1
    dispatch({ type: 'SET_ITEMS', items: [] })
    dispatch({ type: 'SET_PAGE', page: 1 })
    dispatch({ type: 'SET_HAS_MORE', hasMore: true })
    doFetch.current(1, false)
  }, [collKey, filterKey, resetKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Single stable observer — uses refs, never recreated
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return
      if (loadingRef.current || !hasMoreRef.current) return
      const nextPage = pageRef.current + 1
      pageRef.current = nextPage
      dispatch({ type: 'SET_PAGE', page: nextPage })
      doFetch.current(nextPage, true)
    }, { rootMargin: '600px 0px' })
    observerRef.current = observer
    observer.observe(sentinel)
    return () => { observer.disconnect(); observerRef.current = null }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const isLoading = state.loading && state.items.length === 0

  return (
    <main>
      <div className="tabs-wrap">
        {COLLECTIONS.map(c => (
          <button
            key={c.type}
            className={`tab${state.collection === c.type ? ' active' : ''}`}
            onClick={() => {
              dispatch({ type: 'SET_COLLECTION', collection: c.type })
              setResetKey(k => k + 1)
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <FilterBar
        filters={state.filters}
        genres={state.genres}
        filtersActive={filtersActive}
        onFilterChange={f => dispatch({ type: 'SET_FILTERS', filters: f })}
        onApply={() => {
          hasMoreRef.current = true
          pageRef.current = 1
          dispatch({ type: 'SET_ITEMS', items: [] })
          dispatch({ type: 'SET_PAGE', page: 1 })
          doFetch.current(1, false)
        }}
        onReset={() => dispatch({ type: 'RESET_FILTERS' })}
      />

      <div className="grid">
        {isLoading
          ? Array.from({ length: 12 }, (_, i) => <SkeletonCard key={i} />)
          : <FilmGrid items={state.items} onFilmClick={onFilmClick} />
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

const FilterBar = memo(function FilterBar({
  filters, genres, filtersActive, onFilterChange, onApply, onReset,
}: {
  filters: { genre: string; type: string; order: string; yearFrom: string; yearTo: string }
  genres: Genre[]
  filtersActive: boolean
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
      <button className={`btn btn-glass${filtersActive ? ' active' : ''}`} onClick={onApply}>Применить</button>
      <button className="btn btn-glass" onClick={onReset}>Сбросить</button>
    </div>
  )
})
