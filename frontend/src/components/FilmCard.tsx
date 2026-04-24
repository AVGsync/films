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
