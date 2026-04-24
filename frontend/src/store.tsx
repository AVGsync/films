import { createContext, useContext, useReducer, useCallback, type ReactNode } from 'react'
import { type AppState, type View, type LibraryType, type AdminTab, type Film, type Provider, type Genre, type User } from './types'

type Action =
  | { type: 'SET_VIEW'; view: View; prevView?: View }
  | { type: 'SET_PROVIDER'; provider: string }
  | { type: 'SET_PROVIDERS'; providers: Provider[] }
  | { type: 'SET_COLLECTION'; collection: string }
  | { type: 'SET_QUERY'; query: string }
  | { type: 'SET_FILTERS'; filters: Partial<AppState['filters']> }
  | { type: 'RESET_FILTERS' }
  | { type: 'SET_PAGE'; page: number }
  | { type: 'SET_TOTAL_PAGES'; totalPages: number }
  | { type: 'SET_GENRES'; genres: Genre[] }
  | { type: 'SET_ITEMS'; items: Film[] }
  | { type: 'APPEND_ITEMS'; items: Film[] }
  | { type: 'SET_SELECTED'; kpId: number | null }
  | { type: 'SET_TOKEN'; token: string }
  | { type: 'SET_USER'; user: User | null }
  | { type: 'SET_LIBRARY_TYPE'; libraryType: LibraryType }
  | { type: 'SET_ADMIN_TAB'; adminTab: AdminTab }
  | { type: 'SET_LOADING'; loading: boolean }
  | { type: 'SET_HAS_MORE'; hasMore: boolean }
  | { type: 'SET_BACKDROP'; backdrop: string }

const initialState: AppState = {
  view: 'home',
  prevView: 'home',
  provider: 'alloha',
  providers: [{ id: 'alloha', label: 'Alloha' }],
  collection: 'TOP_POPULAR_ALL',
  query: '',
  filters: { genre: '', type: '', order: 'RATING', yearFrom: '', yearTo: '' },
  page: 1,
  totalPages: 1,
  genres: [],
  items: [],
  selectedKpId: null,
  token: localStorage.getItem('cinema.jwt') || '',
  user: null,
  libraryType: 'favorites',
  adminTab: 'overview',
  loading: false,
  hasMore: true,
  backdrop: '',
}

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, view: action.view, prevView: action.prevView ?? state.view }
    case 'SET_PROVIDER':
      return { ...state, provider: action.provider }
    case 'SET_PROVIDERS':
      return { ...state, providers: action.providers }
    case 'SET_COLLECTION':
      return { ...state, collection: action.collection }
    case 'SET_QUERY':
      return { ...state, query: action.query }
    case 'SET_FILTERS':
      return { ...state, filters: { ...state.filters, ...action.filters } }
    case 'RESET_FILTERS':
      return { ...state, filters: { genre: '', type: '', order: 'RATING', yearFrom: '', yearTo: '' } }
    case 'SET_PAGE':
      return { ...state, page: action.page }
    case 'SET_TOTAL_PAGES':
      return { ...state, totalPages: action.totalPages }
    case 'SET_GENRES':
      return { ...state, genres: action.genres }
    case 'SET_ITEMS':
      return { ...state, items: action.items }
    case 'APPEND_ITEMS':
      return { ...state, items: [...state.items, ...action.items] }
    case 'SET_SELECTED':
      return { ...state, selectedKpId: action.kpId }
    case 'SET_TOKEN':
      return { ...state, token: action.token }
    case 'SET_USER':
      return { ...state, user: action.user }
    case 'SET_LIBRARY_TYPE':
      return { ...state, libraryType: action.libraryType }
    case 'SET_ADMIN_TAB':
      return { ...state, adminTab: action.adminTab }
    case 'SET_LOADING':
      return { ...state, loading: action.loading }
    case 'SET_HAS_MORE':
      return { ...state, hasMore: action.hasMore }
    case 'SET_BACKDROP':
      return { ...state, backdrop: action.backdrop }
    default:
      return state
  }
}

interface ContextValue {
  state: AppState
  dispatch: React.Dispatch<Action>
}

const Ctx = createContext<ContextValue>(null!)

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  return <Ctx.Provider value={{ state, dispatch }}>{children}</Ctx.Provider>
}

export function useStore() {
  return useContext(Ctx)
}

export function useDispatch() {
  return useContext(Ctx).dispatch
}

export function useSelector<T>(fn: (s: AppState) => T): T {
  return fn(useContext(Ctx).state)
}

export function usePrevView() {
  const { state, dispatch } = useStore()
  return useCallback(() => {
    const prev = state.prevView
    dispatch({ type: 'SET_VIEW', view: prev === 'search' || prev === 'library' || prev === 'admin' ? prev : 'home' })
  }, [state.prevView, dispatch])
}
