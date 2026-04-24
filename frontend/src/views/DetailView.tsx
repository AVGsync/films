import { useEffect, useRef, useState } from 'react'
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
  const [playerStatus, setPlayerStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [playerError, setPlayerError] = useState('')
  const [isFav, setIsFav] = useState(false)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setFilm(null)
    setPlayerUrl('')
    setPlayerStatus('idle')
    setPlayerError('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    fetchFilm()
  }, [kpId]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const handler = () => {
      if (pageRef.current)
        pageRef.current.style.setProperty('--detail-shift', String(window.scrollY) + 'px')
    }
    window.addEventListener('scroll', handler, { passive: true })
    return () => window.removeEventListener('scroll', handler)
  }, [])

  async function fetchFilm() {
    try {
      const d = await api('/api/film?kp=' + encodeURIComponent(kpId)) as FilmDetail
      setFilm(d)
      if (d.backdrop || d.poster) {
        const bg = proxyImg(d.backdrop || d.poster)
        dispatch({ type: 'SET_BACKDROP', backdrop: bg })
      }
    } catch {}
  }

  async function loadPlayer() {
    setPlayerStatus('loading')
    setPlayerError('')
    if (iframeRef.current) { iframeRef.current.src = ''; iframeRef.current.className = '' }
    try {
      const data = await api(
        `/api/player?provider=${encodeURIComponent(state.provider)}&kp=${encodeURIComponent(kpId)}`
      ) as { playerUrl?: string }
      if (!data.playerUrl) throw new Error('playerUrl отсутствует')
      setPlayerUrl(data.playerUrl)
    } catch (e: unknown) {
      setPlayerStatus('error')
      setPlayerError(e instanceof Error ? e.message : 'Ошибка')
    }
  }

  function onIframeLoad() {
    setPlayerStatus('ready')
    if (iframeRef.current) iframeRef.current.className = 'visible'
    recordHistory()
  }

  async function recordHistory() {
    if (!state.user || !film) return
    try {
      await apiJSON('/api/library/favorites', {
        kpId,
        provider: state.provider,
        title: film.title,
        originalTitle: film.originalTitle,
        year: film.year,
        rating: film.ratingKp,
        poster: film.poster,
        type: 'FILM',
      })
    } catch {}
  }

  async function addFavorite() {
    if (!state.user) return
    try {
      await apiJSON('/api/library/favorites', {
        kpId,
        provider: state.provider,
        title: film?.title,
        year: film?.year,
        rating: film?.ratingKp,
        poster: film?.poster,
      })
      setIsFav(true)
    } catch {}
  }

  const backdropSrc = film ? proxyImg(film.backdrop || film.poster || '') : ''

  return (
    <main>
      {backdropSrc && (
        <div
          style={{
            position: 'fixed',
            inset: '-90px',
            backgroundImage: `url("${backdropSrc}")`,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            filter: 'blur(22px) saturate(1.3) contrast(1.05)',
            opacity: 0.72,
            zIndex: -1,
            pointerEvents: 'none',
            transform: 'translateY(calc(var(--detail-shift, 0px) * -0.04))',
          }}
        >
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(180deg, rgba(10,10,20,0.2) 0%, rgba(10,10,20,0.5) 55%, #0a0a14 100%)',
          }} />
        </div>
      )}

      <div className="detail-page" ref={pageRef}>
        <button className="back-btn" onClick={() => { dispatch({ type: 'SET_BACKDROP', backdrop: '' }); onBack() }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          Назад
        </button>

        <div className="detail-layout">
          <div className="detail-poster">
            {film?.poster
              ? <img src={proxyImg(film.poster)} alt={film.title} />
              : <div className="sk-poster skeleton" style={{ height: '100%' }} />
            }
          </div>

          <div className="detail-main">
            {!film ? (
              <>
                <div className="sk-title skeleton" style={{ height: 28, width: '60%', marginBottom: 12 }} />
                <div className="sk-meta skeleton" style={{ height: 18, width: '40%', marginBottom: 20 }} />
              </>
            ) : (
              <>
                <div className="detail-title">{film.title || `KP ${kpId}`}</div>
                {film.originalTitle && <div className="detail-original">{film.originalTitle}</div>}
                <div className="detail-badges">
                  {film.year && <span className="badge">{film.year}</span>}
                  {film.ratingKp && <span className="badge rating">★ {film.ratingKp} KP</span>}
                  {film.ratingImdb && <span className="badge rating">★ {film.ratingImdb} IMDb</span>}
                  {film.duration && <span className="badge">{film.duration}</span>}
                  {(film.countries || []).slice(0, 2).map(c => <span key={c} className="badge">{c}</span>)}
                  {(film.genres || []).slice(0, 4).map(g => <span key={g} className="badge genre">{g}</span>)}
                </div>
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
                        onClick={() => {
                          dispatch({ type: 'SET_PROVIDER', provider: p.id })
                          setPlayerStatus('idle')
                          setPlayerUrl('')
                          if (iframeRef.current) iframeRef.current.className = ''
                        }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="player-controls">
                  <span className={`status-badge${playerStatus === 'loading' ? ' loading' : playerStatus === 'error' ? ' error' : ''}`}>
                    {playerStatus === 'idle' ? 'Ожидание' : playerStatus === 'loading' ? 'Загрузка...' : playerStatus === 'ready' ? 'Загружен' : 'Ошибка'}
                  </span>
                  {state.user && (
                    <button className="btn btn-glass" onClick={addFavorite}>
                      {isFav ? '★ В избранном' : '☆ В избранное'}
                    </button>
                  )}
                  {playerStatus !== 'idle' && (
                    <button className="btn btn-glass" onClick={loadPlayer}>Перезагрузить</button>
                  )}
                </div>
              </div>

              <div className="player-shell">
                {playerStatus === 'idle' && (
                  <div className="player-placeholder">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none">
                      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.4"/>
                      <path d="M10 8l6 4-6 4V8z" fill="currentColor"/>
                    </svg>
                    <strong>Нажмите для загрузки</strong>
                    <p>Фильм будет доступен через выбранного провайдера</p>
                    <button className="btn btn-primary" style={{ marginTop: 8 }} onClick={loadPlayer}>Загрузить плеер</button>
                  </div>
                )}

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
                    <button className="btn btn-glass" style={{ marginTop: 8 }} onClick={loadPlayer}>Попробовать снова</button>
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
      </div>
    </main>
  )
}
