import { useEffect, useState } from 'react'
import { StoreProvider, useStore } from './store'
import { api, setToken } from './api'
import { type LibraryType } from './types'
import { Header } from './components/Header'
import { AuthModal } from './components/AuthModal'
import { ProfileModal } from './components/ProfileModal'
import { HomeView } from './views/HomeView'
import { SearchView } from './views/SearchView'
import { DetailView } from './views/DetailView'
import { LibraryView } from './views/LibraryView'
import { AdminView } from './views/AdminView'

function Inner() {
  const { state, dispatch } = useStore()
  const [authOpen, setAuthOpen] = useState(false)
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    if (state.token) setToken(state.token)
    Promise.all([loadMe(), loadProviders(), loadFilters()])
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadMe() {
    if (!state.token) return
    try {
      const data = await api('/api/auth/me')
      const user = data.user as { id: number; login: string; email: string; role: string }
      dispatch({ type: 'SET_USER', user })
    } catch {
      localStorage.removeItem('cinema.jwt')
      setToken('')
      dispatch({ type: 'SET_TOKEN', token: '' })
    }
  }

  async function loadProviders() {
    try {
      const data = await api('/api/providers')
      const items = data.items as { id: string; label: string }[]
      if (items?.length) dispatch({ type: 'SET_PROVIDERS', providers: items })
    } catch {}
  }

  async function loadFilters() {
    try {
      const data = await api('/api/filters')
      const genres = (data.genres as { id: number; genre: string }[]) || []
      dispatch({ type: 'SET_GENRES', genres: genres.filter(g => g.genre && g.id) })
    } catch {}
  }

  function handleSearch(q: string) {
    if (!q) {
      if (state.view !== 'home') dispatch({ type: 'SET_VIEW', view: 'home' })
      dispatch({ type: 'SET_QUERY', query: '' })
      return
    }
    dispatch({ type: 'SET_QUERY', query: q })
    dispatch({ type: 'SET_VIEW', view: 'search', prevView: state.view === 'detail' ? state.prevView : state.view })
    dispatch({ type: 'RESET_FILTERS' })
  }

  function goHome() {
    dispatch({ type: 'SET_VIEW', view: 'home' })
    dispatch({ type: 'SET_QUERY', query: '' })
    dispatch({ type: 'SET_BACKDROP', backdrop: '' })
  }

  function goFilm(kpId: number) {
    dispatch({ type: 'SET_SELECTED', kpId })
    dispatch({ type: 'SET_VIEW', view: 'detail', prevView: state.view })
  }

  function goLibrary(type: LibraryType) {
    dispatch({ type: 'SET_LIBRARY_TYPE', libraryType: type })
    dispatch({ type: 'SET_VIEW', view: 'library', prevView: state.view })
  }

  function goAdmin() {
    dispatch({ type: 'SET_VIEW', view: 'admin', prevView: state.view })
  }

  function goBack() {
    const prev = state.prevView
    dispatch({ type: 'SET_BACKDROP', backdrop: '' })
    if (prev === 'search') {
      dispatch({ type: 'SET_VIEW', view: 'search' })
    } else if (prev === 'library') {
      dispatch({ type: 'SET_VIEW', view: 'library' })
    } else if (prev === 'admin') {
      dispatch({ type: 'SET_VIEW', view: 'admin' })
    } else {
      dispatch({ type: 'SET_VIEW', view: 'home' })
    }
  }

  function showAuth(mode: 'login' | 'register' = 'login') {
    setAuthMode(mode)
    setAuthOpen(true)
  }

  return (
    <div className="app-content">
      {state.backdrop && state.view !== 'detail' && (
        <div
          className="app-bg"
          style={{ backgroundImage: `url("${state.backdrop}")` }}
        />
      )}

      <Header
        onSearch={handleSearch}
        onGoHome={goHome}
        onGoLibrary={goLibrary}
        onGoAdmin={goAdmin}
        onShowAuth={() => showAuth('login')}
        onShowProfile={() => setProfileOpen(true)}
        searchQuery={state.query}
      />

      {state.view === 'home' && (
        <HomeView onFilmClick={goFilm} />
      )}
      {state.view === 'search' && (
        <SearchView onFilmClick={goFilm} onBack={goBack} />
      )}
      {state.view === 'detail' && state.selectedKpId !== null && (
        <DetailView kpId={state.selectedKpId} onBack={goBack} />
      )}
      {state.view === 'library' && (
        <LibraryView onFilmClick={goFilm} onBack={goBack} />
      )}
      {state.view === 'admin' && (
        <AdminView onBack={goBack} />
      )}

      <AuthModal
        open={authOpen}
        mode={authMode}
        onClose={() => setAuthOpen(false)}
        onModeChange={m => { setAuthMode(m) }}
      />
      <ProfileModal
        open={profileOpen}
        onClose={() => setProfileOpen(false)}
        onGoLibrary={type => { goLibrary(type); setProfileOpen(false) }}
      />
    </div>
  )
}

export default function App() {
  return (
    <StoreProvider>
      <Inner />
    </StoreProvider>
  )
}
