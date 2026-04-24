import { memo } from 'react'
import { proxyImg } from '../api'
import { type Film } from '../types'

interface Props {
  film: Film
  onClick: () => void
  onRemove?: (e: React.MouseEvent) => void
  showRemove?: boolean
}

export const FilmCard = memo(function FilmCard({ film, onClick, onRemove, showRemove }: Props) {
  const src = proxyImg(film.poster)
  const meta = [film.year, (film.genres || []).slice(0, 2).join(', ')].filter(Boolean).join(' · ')
  const metaLib = film.timestamp
    ? [film.year, new Date(film.timestamp).toLocaleDateString('ru-RU')].filter(Boolean).join(' · ')
    : meta

  const hasTooltip = !!(film.rating || film.ratingKp || film.ratingImdb || (film.genres || []).length > 0 || film.description)
  const genres = (film.genres || []).slice(0, 3)

  return (
    <article className="card" onClick={onClick}>
      <div className="card-poster">
        {src && <img src={src} alt={film.title} loading="lazy" decoding="async" />}
        {film.rating && <span className="card-rating">★ {film.rating}</span>}
      </div>
      <div className="card-info">
        <div className="card-title">{film.title}</div>
        <div className="card-meta">{film.timestamp ? metaLib : meta}</div>
        {showRemove && onRemove && (
          <div className="card-actions">
            <button onClick={onRemove}>Убрать</button>
          </div>
        )}
      </div>
      {hasTooltip && (
        <div className="card-tooltip">
          <div className="card-tooltip-title">{film.title}</div>
          {(film.ratingKp || film.rating || film.ratingImdb) && (
            <div className="card-tooltip-ratings">
              {(film.ratingKp || film.rating) && (
                <span className="card-tooltip-rating">★ {film.ratingKp ?? film.rating}</span>
              )}
              {film.ratingImdb && (
                <span className="card-tooltip-rating imdb">IMDb {film.ratingImdb}</span>
              )}
            </div>
          )}
          {(film.year || film.countries) && (
            <div className="card-tooltip-meta">
              {[film.year, (film.countries || []).slice(0, 2).join(', ')].filter(Boolean).join(' · ')}
            </div>
          )}
          {genres.length > 0 && (
            <div className="card-tooltip-genres">
              {genres.map(g => <span key={g} className="card-tooltip-genre">{g}</span>)}
            </div>
          )}
          {film.description && (
            <div className="card-tooltip-desc">{film.description}</div>
          )}
        </div>
      )}
    </article>
  )
})

export const SkeletonCard = memo(function SkeletonCard() {
  return (
    <div className="card">
      <div className="sk-poster skeleton" />
      <div className="sk-title skeleton" />
      <div className="sk-meta skeleton" />
    </div>
  )
})
