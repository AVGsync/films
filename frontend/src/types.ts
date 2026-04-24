export interface Film {
  kpId: number
  title: string
  originalTitle?: string
  year?: number
  rating?: number
  ratingKp?: number
  ratingImdb?: number
  poster?: string
  backdrop?: string
  description?: string
  slogan?: string
  duration?: string
  genres?: string[]
  countries?: string[]
  type?: string
  provider?: string
  timestamp?: string
}

export interface Provider {
  id: string
  label: string
  async?: boolean
}

export interface User {
  id: number
  login: string
  email: string
  role: string
  createdAt?: string
}

export interface Genre {
  id: number
  genre: string
}

export type View = 'home' | 'search' | 'detail' | 'library' | 'admin'
export type LibraryType = 'favorites' | 'history'
export type AdminTab = 'overview' | 'users' | 'favorites' | 'history' | 'players'

export interface AppState {
  view: View
  prevView: View
  provider: string
  providers: Provider[]
  collection: string
  query: string
  filters: {
    genre: string
    type: string
    order: string
    yearFrom: string
    yearTo: string
  }
  page: number
  totalPages: number
  genres: Genre[]
  items: Film[]
  selectedKpId: number | null
  token: string
  user: User | null
  libraryType: LibraryType
  adminTab: AdminTab
  loading: boolean
  hasMore: boolean
  backdrop: string
}
