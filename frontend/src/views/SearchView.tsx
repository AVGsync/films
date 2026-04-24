import { useEffect, useRef } from 'react'
import { useStore } from '../store'
import { api } from '../api'
import { FilmCard, SkeletonCard } from '../components/FilmCard'
import { type Film, type Genre, type AppState } from '../types'

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

function parseSmartQuery(raw: string, genres: Genre[]) {
  let text = String(raw || '').toLowerCase()
  const years = [...text.matchAll(/\b(19\d{2}|20[0-3]\d)\b/g)].map(m => m[1])
  const out = { keyword: '', genre: '', type: '', yearFrom: '', yearTo: '' }
  if (years.length === 1) { out.yearFrom = years[0]; out.yearTo = years[0] }
  else if (years.length > 1) { out.yearFrom = years[0]; out.yearTo = years[1] }
  text = text.replace(/\b(19\d{2}|20[0-3]\d)\b/g, ' ')
  if (/(сериал|сериалы|series)/i.test(text)) out.type = 'TV_SERIES'
  if (/(фильм|фильмы|movie|film)/i.test(text)) out.type = 'FILM'
  text = text.replace(/\b(сериал|сериалы|series|фильм|фильмы|movie|film|года|год|топ|лучшие|лучшее|популярные|популярное|новые|новинки)\b/gi, ' ')
  const genre = genres
    .filter(g => g.genre).sort((a, b) => b.genre.length - a.genre.length)
    .find(g => text.includes(g.genre.toLowerCase()))
  if (genre) { out.genre = String(genre.id); text = text.replace(genre.genre.toLowerCase(), ' ') }
  out.keyword = text.replace(/[^\p{L}\p{N}\s-]/gu, ' ').replace(/\s+/g, ' ').trim()
  return out
}

function buildSearchParams(s: AppState, page: number): URLSearchParams {
  const smart = parseSmartQuery(s.query, s.genres)
  const params = new URLSearchParams()
  params.set('page', String(page))
  const keyword = smart.keyword || s.query
  if (keyword) params.set('keyword', keyword)
  if (s.filters.genre || smart.genre) params.set('genres', s.filters.genre || smart.genre)
  if (s.filters.type || smart.type) params.set('type', s.filters.type || smart.type)
  if (s.filters.order) params.set('order', s.filters.order)
  if (s.filters.yearFrom || smart.yearFrom) params.set('yearFrom', s.filters.yearFrom || smart.yearFrom)
  if (s.filters.yearTo || smart.yearTo) params.set('yearTo', s.filters.yearTo || smart.yearTo)
  return params
}

interface Props {
  onFilmClick: (kpId: number) => void
  onBack: () => void
}

export function SearchView({ onFilmClick, onBack }: Props) {
  const { state, dispatch } = useStore()
  const stateRef = useRef(state)
  stateRef.current = state
  const loadingRef = useRef(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const totalRef = useRef(0)

  // Stable fetch with full-text search: try /api/search first for pure keyword,
  // fall back to /api/films with filter params for paged filtered results
  const doFetch = useRef(async (page: number, append: boolean) => {
    if (loadingRef.current) return
    loadingRef.current = true
    dispatch({ type: 'SET_LOADING', loading: true })
    const s = stateRef.current
    const hasFilters = Boolean(s.filters.genre || s.filters.type || s.filters.yearFrom || s.filters.yearTo)
    try {
      let items: Film[] = []
      let hasMore = false

      if (!hasFilters && s.query && page === 1) {
        // Fast full-text search for first page, no filters
        try {
          const data = await api('/api/search?q=' + encodeURIComponent(s.query))
          items = (data.items as Film[]) || []
          totalRef.current = items.length
          hasMore = false // /api/search returns all at once
        } catch {
          // fallback to /api/films
          const data = await api('/api/films?' + buildSearchParams(s, page).toString())
          items = (data.items as Film[]) || []
          const totalPages = (data.totalPages as number) || 1
          if (!append) { totalRef.current = (data.total as number) || 0; dispatch({ type: 'SET_TOTAL_PAGES', totalPages }) }
          hasMore = page < totalPages && items.length > 0
        }
      } else {
        // Filtered / paginated search via /api/films
        const data = await api('/api/films?' + buildSearchParams(s, page).toString())
        items = (data.items as Film[]) || []
        const totalPages = (data.totalPages as number) || 1
        if (!append) { totalRef.current = (data.total as number) || 0; dispatch({ type: 'SET_TOTAL_PAGES', totalPages }) }
        hasMore = page < totalPages && items.length > 0

        // If /api/films returns nothing for page 1, try /api/search as fallback
        if (items.length === 0 && page === 1 && s.query) {
          try {
            const data2 = await api('/api/search?q=' + encodeURIComponent(s.query))
            items = (data2.items as Film[]) || []
            totalRef.current = items.length
            hasMore = false
          } catch {}
        }
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

  const queryKey = state.query
  const filterKey = `${state.filters.genre}|${state.filters.type}|${state.filters.order}|${state.filters.yearFrom}|${state.filters.yearTo}`

  useEffect(() => {
    dispatch({ type: 'SET_ITEMS', items: [] })
    dispatch({ type: 'SET_PAGE', page: 1 })
    dispatch({ type: 'SET_HAS_MORE', hasMore: true })
    totalRef.current = 0
    doFetch.current(1, false)
  }, [queryKey, filterKey]) // eslint-disable-line react-hooks/exhaustive-deps

  // Stable observer
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
      <button className="back-btn" onClick={onBack}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Назад
      </button>
      <div className="page-title">
        Поиск: «{state.query}»
        {totalRef.current > 0 && <small>{totalRef.current} результатов</small>}
      </div>

      <div className="filter-bar">
        <select value={state.filters.genre}
          onChange={e => dispatch({ type: 'SET_FILTERS', filters: { genre: e.target.value } })}>
          <option value="">Жанр</option>
          {state.genres.map(g => <option key={g.id} value={String(g.id)}>{g.genre}</option>)}
        </select>
        <select value={state.filters.type}
          onChange={e => dispatch({ type: 'SET_FILTERS', filters: { type: e.target.value } })}>
          {TYPES.map(t => <option key={t.val} value={t.val}>{t.label}</option>)}
        </select>
        <select value={state.filters.order}
          onChange={e => dispatch({ type: 'SET_FILTERS', filters: { order: e.target.value } })}>
          {ORDERS.map(o => <option key={o.val} value={o.val}>{o.label}</option>)}
        </select>
        <label>Год от</label>
        <input type="number" placeholder="1990" min="1900" max="2035" value={state.filters.yearFrom}
          onChange={e => dispatch({ type: 'SET_FILTERS', filters: { yearFrom: e.target.value } })} />
        <label>до</label>
        <input type="number" placeholder="2026" min="1900" max="2035" value={state.filters.yearTo}
          onChange={e => dispatch({ type: 'SET_FILTERS', filters: { yearTo: e.target.value } })} />
        <button className="btn btn-glass" onClick={() => dispatch({ type: 'RESET_FILTERS' })}>Сбросить</button>
      </div>

      <div className="grid">
        {isLoading
          ? Array.from({ length: 12 }, (_, i) => <SkeletonCard key={i} />)
          : state.items.length === 0 && !state.loading
            ? <div className="state-box"><strong>Ничего не найдено</strong>Попробуйте другой запрос</div>
            : state.items.map(film => (
              <FilmCard key={film.kpId} film={film} onClick={() => onFilmClick(film.kpId)} />
            ))
        }
      </div>

      <div className="scroll-sentinel" ref={sentinelRef}>
        {state.loading && state.items.length > 0 && 'Загрузка...'}
        {!state.hasMore && state.items.length > 0 && 'Загружено всё'}
      </div>
    </main>
  )
}
