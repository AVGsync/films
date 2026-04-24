import { useEffect, useRef, useState, useCallback } from 'react'
import { api, apiJSON, proxyImg } from '../api'
import { useStore } from '../store'

interface FilmDetail {
  title?: string
  originalTitle?: string
  year?: number
  ratingKp?: number
  ratingImdb?: number
  duration?: string
  countries?: string[]
  genres?: string[]
  description?: string
  slogan?: string
  poster?: string
  backdrop?: string
}

interface Props {
  kpId: number
  onBack: () => void
}

export function DetailView({ kpId, onBack }: Props) {
  const { state, dispatch } = useStore()
  const [film, setFilm] = useState<FilmDetail | null>(null)
  const [playerUrl, setPlayerUrl] = useState('')
  const [playerStatus, setPlayerStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [playerError, setPlayerError] = useState('')
  const [isFav, setIsFav] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const filmRef = useRef<FilmDetail | null>(null)

  useEffect(() => {
    setFilm(null)
    filmRef.current = null
    setPlayerUrl('')
    setPlayerStatus('loading')
    setPlayerError('')
    setIsFav(false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    fetchFilm()
  }, [kpId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-load player when provider changes (and kpId known)
  useEffect(() => {
    if (!kpId) return
    loadPlayer(state.provider)
  }, [state.provider, kpId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function fetchFilm() {
    try {
      const d = await api('/api/film?kp=' + encodeURIComponent(kpId)) as FilmDetail
      setFilm(d)
      filmRef.current = d
      if (d.backdrop || d.poster) {
        dispatch({ type: 'SET_BACKDROP', backdrop: proxyImg(d.backdrop || d.poster) })
      }
    } catch {}
  }

  const loadPlayer = useCallback(async (provider: string) => {
    setPlayerStatus('loading')
    setPlayerError('')
    setPlayerUrl('')
    if (iframeRef.current) { iframeRef.current.src = ''; iframeRef.current.className = '' }
    try {
      const data = await api(
        `/api/player?provider=${encodeURIComponent(provider)}&kp=${encodeURIComponent(kpId)}`
      ) as { playerUrl?: string }
      if (!data.playerUrl) throw new Error('playerUrl отсутствует')
      setPlayerUrl(data.playerUrl)
    } catch (e: unknown) {
      setPlayerStatus('error')
      setPlayerError(e instanceof Error ? e.message : 'Ошибка')
    }
  }, [kpId])

  function onIframeLoad() {
    setPlayerStatus('ready')
    if (iframeRef.current) iframeRef.current.className = 'visible'
    recordHistory()
  }

  async function recordHistory() {
    const f = filmRef.current
    if (!state.user || !f) return
    try {
      await apiJSON('/api/library/history', {
        kpId, provider: state.provider,
        title: f.title, originalTitle: f.originalTitle,
        year: f.year, rating: f.ratingKp, poster: f.poster, type: 'FILM',
      })
    } catch {}
  }

  async function addFavorite() {
    if (!state.user) return
    const f = filmRef.current
    try {
      await apiJSON('/api/library/favorites', {
        kpId, provider: state.provider,
        title: f?.title, year: f?.year, rating: f?.ratingKp, poster: f?.poster,
      })
      setIsFav(true)
    } catch {}
  }

  const backdropSrc = film ? proxyImg(film.backdrop || film.poster || '') : ''

  return (
    <main>
      {backdropSrc && <>
        <div className="detail-fixed-bg" style={{ backgroundImage: `url("${backdropSrc}")` }} />
        <div className="detail-fixed-overlay" />
      </>}

      <button className="back-btn" onClick={() => { dispatch({ type: 'SET_BACKDROP', backdrop: '' }); onBack() }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        Назад
      </button>

      <div className="detail-layout">
        {/* LEFT: poster + meta badges */}
        <div className="detail-left">
          <div className="detail-poster">
            {film?.poster
              ? <img src={proxyImg(film.poster)} alt={film.title} />
              : <div className="sk-poster skeleton" style={{ height: '100%' }} />
            }
          </div>

          {film && (
            <div className="detail-meta-panel">
              {film.ratingKp && (
                <div className="meta-row">
                  <span className="meta-label">KP</span>
                  <span className="meta-value rating">★ {film.ratingKp}</span>
                </div>
              )}
              {film.ratingImdb && (
                <div className="meta-row">
                  <span className="meta-label">IMDb</span>
                  <span className="meta-value rating">★ {film.ratingImdb}</span>
                </div>
              )}
              {film.year && (
                <div className="meta-row">
                  <span className="meta-label">Год</span>
                  <span className="meta-value">{film.year}</span>
                </div>
              )}
              {film.duration && (
                <div className="meta-row">
                  <span className="meta-label">Длит.</span>
                  <span className="meta-value">{film.duration}</span>
                </div>
              )}
              {(film.countries || []).length > 0 && (
                <div className="meta-row">
                  <span className="meta-label">Страна</span>
                  <span className="meta-value">{(film.countries || []).slice(0, 2).join(', ')}</span>
                </div>
              )}
              {(film.genres || []).length > 0 && (
                <div className="meta-row">
                  <span className="meta-label">Жанр</span>
                  <span className="meta-value genre">{(film.genres || []).slice(0, 3).join(', ')}</span>
                </div>
              )}
              {state.user && (
                <button
                  className={`btn btn-glass fav-btn${isFav ? ' fav-active' : ''}`}
                  onClick={addFavorite}
                  style={{ marginTop: 10, width: '100%' }}
                >
                  {isFav ? '★ В избранном' : '☆ Избранное'}
                </button>
              )}
            </div>
          )}
        </div>

        {/* RIGHT: title + desc + player */}
        <div className="detail-main">
          {!film ? (
            <>
              <div className="sk-title skeleton" style={{ height: 28, width: '60%', marginBottom: 12 }} />
              <div className="sk-meta skeleton" style={{ height: 18, width: '40%', marginBottom: 20 }} />
              <div className="sk-meta skeleton" style={{ height: 14, width: '90%', marginBottom: 8 }} />
              <div className="sk-meta skeleton" style={{ height: 14, width: '80%', marginBottom: 8 }} />
            </>
          ) : (
            <>
              <div className="detail-title">{film.title || `KP ${kpId}`}</div>
              {film.originalTitle && <div className="detail-original">{film.originalTitle}</div>}
              <div className="detail-desc">{film.description || film.slogan || 'Описание недоступно'}</div>
            </>
          )}

          <div className="player-section">
            <div className="player-header">
              <div>
                <div className="player-title">Плеер</div>
                <div className="provider-tabs">
                  {state.providers.map(p => (
                    <button
                      key={p.id}
                      className={`provider-tab${state.provider === p.id ? ' active' : ''}`}
                      onClick={() => dispatch({ type: 'SET_PROVIDER', provider: p.id })}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="player-controls">
                <span className={`status-badge${playerStatus === 'loading' ? ' loading' : playerStatus === 'error' ? ' error' : ''}`}>
                  {playerStatus === 'loading' ? 'Загрузка...' : playerStatus === 'ready' ? 'Загружен' : 'Ошибка'}
                </span>
                <button className="btn btn-glass" onClick={() => loadPlayer(state.provider)}>
                  Перезагрузить
                </button>
              </div>
            </div>

            <div className="player-shell">
              {playerStatus === 'loading' && (
                <div className="player-overlay active">
                  <div className="spinner" />
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>Загружаем плеер...</span>
                </div>
              )}

              {playerStatus === 'error' && (
                <div className="player-placeholder">
                  <svg width="40" height="40" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.4"/>
                    <path d="M12 8v5M12 15.5v.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <strong>Ошибка загрузки</strong>
                  <p>{playerError}</p>
                  <button className="btn btn-glass" style={{ marginTop: 8 }} onClick={() => loadPlayer(state.provider)}>
                    Попробовать снова
                  </button>
                </div>
              )}

              {playerUrl && (
                <iframe
                  ref={iframeRef}
                  src={playerUrl}
                  allowFullScreen
                  allow="autoplay; fullscreen; encrypted-media"
                  onLoad={onIframeLoad}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}
