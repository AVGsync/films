package main

import (
	"bytes"
	"context"
	"crypto/sha1"
	"crypto/tls"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/http/cookiejar"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

const defaultReferer = "https://rezka.ag/"

var (
	defaultKinopoiskAPIKey = envOrDefault("KINOPOISK_API_KEY", "")
	defaultAllohaToken     = envOrDefault("ALLOHA_API_TOKEN", "")
	defaultCollapsToken    = envOrDefault("COLLAPS_API_TOKEN", "")
	defaultRedisAddr       = envOrDefault("REDIS_ADDR", "")
	defaultRedisPassword   = envOrDefault("REDIS_PASSWORD", "")
	defaultRedisDB         = envIntOrDefault("REDIS_DB", 0)
	defaultLibraryUser     = envOrDefault("LIBRARY_USER_ID", "default")

	headTagRe           = regexp.MustCompile(`(?i)<head[^>]*>`)
	cspMetaRe           = regexp.MustCompile(`(?i)<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*/?>`)
	integrityAttrRe     = regexp.MustCompile(`(?i)\s+integrity="[^"]*"|\s+integrity='[^']*'`)
	upstreamCookieJar   = mustCookieJar()
	redisClient         *redis.Client
	redisEnabled        bool
	upstreamCacheTTL    = 30 * time.Minute
	detailCacheTTL      = 6 * time.Hour
	filterCacheTTL      = 24 * time.Hour
	collectionsCacheTTL = 45 * time.Minute
)

const proxyPatchScriptTpl = `<script>(function(){` +
	`var B=location.origin+'/proxy?url=',PB=%s;` +
	`function px(u){` +
	`if(typeof u!=='string'||u===''||u[0]==='#')return u;` +
	`if(u.startsWith('data:')||u.startsWith('blob:'))return u;` +
	`if(u.startsWith('/proxy?url='))return u;` +
	`if(u.startsWith('http://')||u.startsWith('https://'))return B+encodeURIComponent(u);` +
	`try{return B+encodeURIComponent(new URL(u,PB).href);}catch(e){return u;}` +
	`}` +
	`var _f=window.fetch;` +
	`window.fetch=function(r,o){` +
	`if(typeof r==='string')r=px(r);` +
	`else if(r instanceof Request)r=new Request(px(r.url),r);` +
	`return _f.call(this,r,o);};` +
	`var _x=XMLHttpRequest.prototype.open;` +
	`XMLHttpRequest.prototype.open=function(){` +
	`var a=Array.prototype.slice.call(arguments);a[1]=px(a[1]);return _x.apply(this,a);};` +
	`var _d=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src');` +
	`if(_d&&_d.set)Object.defineProperty(HTMLImageElement.prototype,'src',` +
	`{set:function(v){_d.set.call(this,px(v));},get:_d.get,configurable:true});` +
	`})();</script>`

type appError struct {
	Error   string `json:"error"`
	Details string `json:"details,omitempty"`
}

type searchItem struct {
	KPID          int      `json:"kpId"`
	Title         string   `json:"title"`
	OriginalTitle string   `json:"originalTitle,omitempty"`
	Year          string   `json:"year,omitempty"`
	Rating        string   `json:"rating,omitempty"`
	Poster        string   `json:"poster,omitempty"`
	Genres        []string `json:"genres,omitempty"`
	Countries     []string `json:"countries,omitempty"`
	Type          string   `json:"type,omitempty"`
}

type filmDetails struct {
	KPID          int      `json:"kpId"`
	Title         string   `json:"title"`
	OriginalTitle string   `json:"originalTitle,omitempty"`
	Year          string   `json:"year,omitempty"`
	RatingKP      string   `json:"ratingKp,omitempty"`
	RatingIMDb    string   `json:"ratingImdb,omitempty"`
	Duration      string   `json:"duration,omitempty"`
	Poster        string   `json:"poster,omitempty"`
	Backdrop      string   `json:"backdrop,omitempty"`
	Description   string   `json:"description,omitempty"`
	Slogan        string   `json:"slogan,omitempty"`
	Genres        []string `json:"genres,omitempty"`
	Countries     []string `json:"countries,omitempty"`
	Type          string   `json:"type,omitempty"`
}

type playerPayload struct {
	Provider  string `json:"provider"`
	PlayerURL string `json:"playerUrl"`
	Direct    bool   `json:"direct"`
}

type libraryItem struct {
	KPID          int    `json:"kpId"`
	Title         string `json:"title"`
	OriginalTitle string `json:"originalTitle,omitempty"`
	Year          string `json:"year,omitempty"`
	Rating        string `json:"rating,omitempty"`
	Poster        string `json:"poster,omitempty"`
	Type          string `json:"type,omitempty"`
	Provider      string `json:"provider,omitempty"`
	Timestamp     string `json:"timestamp"`
}

var fallbackFilms = []searchItem{
	{KPID: 258687, Title: "Интерстеллар", Year: "2014", Rating: "8.6", Poster: "https://kinopoiskapiunofficial.tech/images/posters/kp_small/258687.jpg", Genres: []string{"фантастика", "драма"}, Countries: []string{"США", "Великобритания"}},
	{KPID: 301, Title: "Матрица", Year: "1999", Rating: "8.5", Poster: "https://kinopoiskapiunofficial.tech/images/posters/kp_small/301.jpg", Genres: []string{"фантастика", "боевик"}, Countries: []string{"США"}},
	{KPID: 41519, Title: "Брат", Year: "1997", Rating: "8.3", Poster: "https://kinopoiskapiunofficial.tech/images/posters/kp_small/41519.jpg", Genres: []string{"драма", "криминал"}, Countries: []string{"Россия"}},
}

func main() {
	port := envOrDefault("PORT", "8080")
	initRedis()

	if defaultKinopoiskAPIKey == "" {
		log.Println("WARNING: KINOPOISK_API_KEY not set")
	}
	if defaultAllohaToken == "" {
		log.Println("WARNING: ALLOHA_API_TOKEN not set")
	}
	if defaultCollapsToken == "" {
		log.Println("WARNING: COLLAPS_API_TOKEN not set")
	}

	mux := http.NewServeMux()
	mux.HandleFunc("/api/top", handleTop)
	mux.HandleFunc("/api/collections", handleCollections)
	mux.HandleFunc("/api/films", handleFilmsFilter)
	mux.HandleFunc("/api/filters", handleFilters)
	mux.HandleFunc("/api/search", handleSearch)
	mux.HandleFunc("/api/film", handleFilm)
	mux.HandleFunc("/api/player", handlePlayer)
	mux.HandleFunc("/api/library/history", handleHistory)
	mux.HandleFunc("/api/library/favorites", handleFavorites)
	mux.HandleFunc("/proxy", proxyHandler)
	mux.HandleFunc("/", serveIndex)

	server := &http.Server{
		Addr:              ":" + port,
		Handler:           mux,
		ReadHeaderTimeout: 15 * time.Second,
	}

	log.Printf("Cinema server: http://localhost:%s", port)
	log.Fatal(server.ListenAndServe())
}

func serveIndex(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	http.ServeFile(w, r, "index.html")
}

func initRedis() {
	if strings.TrimSpace(defaultRedisAddr) == "" {
		log.Println("Redis off: REDIS_ADDR empty")
		return
	}

	redisClient = redis.NewClient(&redis.Options{
		Addr:         defaultRedisAddr,
		Password:     defaultRedisPassword,
		DB:           defaultRedisDB,
		ReadTimeout:  3 * time.Second,
		WriteTimeout: 3 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	if err := redisClient.Ping(ctx).Err(); err != nil {
		log.Printf("Redis off: %v", err)
		redisClient = nil
		return
	}

	redisEnabled = true
	log.Printf("Redis on: %s db=%d", defaultRedisAddr, defaultRedisDB)
}

// handleTop returns popular films (alias for collections with TOP_POPULAR_ALL).
func handleTop(w http.ResponseWriter, r *http.Request) {
	items, err := collectionViaKinopoisk(r.Context(), "TOP_POPULAR_ALL", "1")
	if err != nil || len(items) == 0 {
		items = fallbackFilms
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
		"count": len(items),
	})
}

// handleCollections returns films from a named KP collection.
func handleCollections(w http.ResponseWriter, r *http.Request) {
	collType := strings.TrimSpace(r.URL.Query().Get("type"))
	if collType == "" {
		collType = "TOP_POPULAR_ALL"
	}
	page := strings.TrimSpace(r.URL.Query().Get("page"))
	if page == "" {
		page = "1"
	}

	items, err := collectionViaKinopoisk(r.Context(), collType, page)
	if err != nil || len(items) == 0 {
		if collType == "TOP_POPULAR_ALL" || collType == "TOP_250_MOVIES" {
			writeJSON(w, http.StatusOK, map[string]any{"items": fallbackFilms, "count": len(fallbackFilms)})
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"items": []searchItem{}, "count": 0})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": items,
		"count": len(items),
		"type":  collType,
	})
}

func collectionViaKinopoisk(ctx context.Context, collType, page string) ([]searchItem, error) {
	target := "https://kinopoiskapiunofficial.tech/api/v2.2/films/collections?type=" + url.QueryEscape(collType) + "&page=" + url.QueryEscape(page)
	body, err := fetchCachedUpstreamBytes(ctx, http.MethodGet, target, nil, http.Header{
		"X-Api-Key": []string{defaultKinopoiskAPIKey},
		"Accept":    []string{"application/json"},
	}, collectionsCacheTTL)
	if err != nil {
		return nil, err
	}

	var payload struct {
		Total      int `json:"total"`
		TotalPages int `json:"totalPages"`
		Items      []struct {
			KinopoiskID      int     `json:"kinopoiskId"`
			NameRu           string  `json:"nameRu"`
			NameEn           string  `json:"nameEn"`
			Year             any     `json:"year"`
			RatingKinopoisk  float64 `json:"ratingKinopoisk"`
			RatingImdb       float64 `json:"ratingImdb"`
			PosterURL        string  `json:"posterUrl"`
			PosterURLPreview string  `json:"posterUrlPreview"`
			Type             string  `json:"type"`
			Countries        []struct {
				Country string `json:"country"`
			} `json:"countries"`
			Genres []struct {
				Genre string `json:"genre"`
			} `json:"genres"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, err
	}

	items := make([]searchItem, 0, len(payload.Items))
	for _, film := range payload.Items {
		rating := ""
		if film.RatingKinopoisk > 0 {
			rating = strconv.FormatFloat(film.RatingKinopoisk, 'f', 1, 64)
		}
		items = append(items, searchItem{
			KPID:          film.KinopoiskID,
			Title:         firstNonEmpty(film.NameRu, film.NameEn, fmt.Sprintf("KP %d", film.KinopoiskID)),
			OriginalTitle: fallbackOriginalTitle(film.NameRu, film.NameEn),
			Year:          normalizeValue(film.Year),
			Rating:        rating,
			Poster:        firstNonEmpty(film.PosterURLPreview, film.PosterURL),
			Genres:        collectSearchGenres(film.Genres),
			Countries:     collectSearchCountries(film.Countries),
			Type:          strings.TrimSpace(film.Type),
		})
	}
	return items, nil
}

// handleFilmsFilter: keyword → v2.1 search-by-keyword; filters only → v2.2/films.
func handleFilmsFilter(w http.ResponseWriter, r *http.Request) {
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	page := strings.TrimSpace(r.URL.Query().Get("page"))
	if page == "" {
		page = "1"
	}

	if keyword != "" {
		items, _, err := searchViaKinopoisk(r.Context(), keyword)
		if err != nil {
			writeError(w, http.StatusBadGateway, "Ошибка поиска KP", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items":      items,
			"count":      len(items),
			"total":      len(items),
			"totalPages": 1,
		})
		return
	}

	params := url.Values{}
	for _, key := range []string{"countries", "genres", "order", "type", "ratingFrom", "ratingTo", "yearFrom", "yearTo"} {
		if val := strings.TrimSpace(r.URL.Query().Get(key)); val != "" {
			params.Set(key, val)
		}
	}
	params.Set("page", page)

	target := "https://kinopoiskapiunofficial.tech/api/v2.2/films?" + params.Encode()
	body, err := fetchCachedUpstreamBytes(r.Context(), http.MethodGet, target, nil, http.Header{
		"X-Api-Key": []string{defaultKinopoiskAPIKey},
		"Accept":    []string{"application/json"},
	}, upstreamCacheTTL)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Ошибка KP API", err.Error())
		return
	}

	var payload struct {
		Total      int `json:"total"`
		TotalPages int `json:"totalPages"`
		Items      []struct {
			KinopoiskID      int     `json:"kinopoiskId"`
			NameRu           string  `json:"nameRu"`
			NameEn           string  `json:"nameEn"`
			Year             any     `json:"year"`
			RatingKinopoisk  float64 `json:"ratingKinopoisk"`
			PosterURL        string  `json:"posterUrl"`
			PosterURLPreview string  `json:"posterUrlPreview"`
			Type             string  `json:"type"`
			Countries        []struct {
				Country string `json:"country"`
			} `json:"countries"`
			Genres []struct {
				Genre string `json:"genre"`
			} `json:"genres"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		writeError(w, http.StatusBadGateway, "Ошибка разбора ответа", err.Error())
		return
	}

	items := make([]searchItem, 0, len(payload.Items))
	for _, film := range payload.Items {
		rating := ""
		if film.RatingKinopoisk > 0 {
			rating = strconv.FormatFloat(film.RatingKinopoisk, 'f', 1, 64)
		}
		items = append(items, searchItem{
			KPID:          film.KinopoiskID,
			Title:         firstNonEmpty(film.NameRu, film.NameEn, fmt.Sprintf("KP %d", film.KinopoiskID)),
			OriginalTitle: fallbackOriginalTitle(film.NameRu, film.NameEn),
			Year:          normalizeValue(film.Year),
			Rating:        rating,
			Poster:        firstNonEmpty(film.PosterURLPreview, film.PosterURL),
			Genres:        collectSearchGenres(film.Genres),
			Countries:     collectSearchCountries(film.Countries),
			Type:          strings.TrimSpace(film.Type),
		})
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"items":      items,
		"count":      len(items),
		"total":      payload.Total,
		"totalPages": payload.TotalPages,
	})
}

// handleFilters proxies /api/v2.2/films/filters for genre/country IDs.
func handleFilters(w http.ResponseWriter, r *http.Request) {
	body, err := fetchCachedUpstreamBytes(r.Context(), http.MethodGet,
		"https://kinopoiskapiunofficial.tech/api/v2.2/films/filters",
		nil,
		http.Header{
			"X-Api-Key": []string{defaultKinopoiskAPIKey},
			"Accept":    []string{"application/json"},
		}, filterCacheTTL)
	if err != nil {
		writeError(w, http.StatusBadGateway, "Не удалось загрузить фильтры", err.Error())
		return
	}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "public, max-age=3600")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(body)
}

func handleSearch(w http.ResponseWriter, r *http.Request) {
	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if query == "" {
		writeError(w, http.StatusBadRequest, "Пустой поисковый запрос", "")
		return
	}

	items, source, err := searchViaKinopoisk(r.Context(), query)
	if err != nil || len(items) == 0 {
		var found []searchItem
		for _, f := range fallbackFilms {
			if strings.Contains(strings.ToLower(f.Title), strings.ToLower(query)) {
				found = append(found, f)
			}
		}
		items = found
		source = "fallback"
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  items,
		"query":  query,
		"count":  len(items),
		"source": source,
	})
}

func handleFilm(w http.ResponseWriter, r *http.Request) {
	kpID := strings.TrimSpace(r.URL.Query().Get("kp"))
	if kpID == "" {
		writeError(w, http.StatusBadRequest, "Не передан Kinopoisk ID", "")
		return
	}

	details, err := filmViaKinopoisk(r.Context(), kpID)
	if err != nil || details.Title == "" {
		details, err = filmViaAlloha(r.Context(), kpID)
	}
	if err != nil {
		writeError(w, http.StatusBadGateway, "Не удалось загрузить карточку фильма", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, details)
}

func searchViaKinopoisk(ctx context.Context, query string) ([]searchItem, string, error) {
	target := "https://kinopoiskapiunofficial.tech/api/v2.1/films/search-by-keyword?keyword=" + url.QueryEscape(query) + "&page=1"
	body, err := fetchCachedUpstreamBytes(ctx, http.MethodGet, target, nil, http.Header{
		"X-Api-Key": []string{defaultKinopoiskAPIKey},
		"Accept":    []string{"application/json"},
	}, upstreamCacheTTL)
	if err != nil {
		return nil, "", err
	}

	var payload struct {
		Films []struct {
			FilmID           int    `json:"filmId"`
			NameRu           string `json:"nameRu"`
			NameEn           string `json:"nameEn"`
			Year             string `json:"year"`
			Rating           string `json:"rating"`
			PosterURLPreview string `json:"posterUrlPreview"`
			Type             string `json:"type"`
			Countries        []struct {
				Country string `json:"country"`
			} `json:"countries"`
			Genres []struct {
				Genre string `json:"genre"`
			} `json:"genres"`
		} `json:"films"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return nil, "", err
	}

	items := make([]searchItem, 0, len(payload.Films))
	for i, film := range payload.Films {
		if i >= 20 {
			break
		}
		items = append(items, searchItem{
			KPID:          film.FilmID,
			Title:         firstNonEmpty(film.NameRu, film.NameEn, fmt.Sprintf("KP %d", film.FilmID)),
			OriginalTitle: fallbackOriginalTitle(film.NameRu, film.NameEn),
			Year:          strings.TrimSpace(film.Year),
			Rating:        strings.TrimSpace(film.Rating),
			Poster:        strings.TrimSpace(film.PosterURLPreview),
			Genres:        collectSearchGenres(film.Genres),
			Countries:     collectSearchCountries(film.Countries),
			Type:          strings.TrimSpace(film.Type),
		})
	}
	return items, "kinopoisk", nil
}

func filmViaKinopoisk(ctx context.Context, kpID string) (filmDetails, error) {
	target := "https://kinopoiskapiunofficial.tech/api/v2.2/films/" + url.PathEscape(kpID)
	body, err := fetchCachedUpstreamBytes(ctx, http.MethodGet, target, nil, http.Header{
		"X-Api-Key": []string{defaultKinopoiskAPIKey},
		"Accept":    []string{"application/json"},
	}, detailCacheTTL)
	if err != nil {
		return filmDetails{}, err
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return filmDetails{}, err
	}

	details := filmDetails{
		KPID:          intValue(payload["kinopoiskId"]),
		Title:         firstNonEmpty(stringValue(payload["nameRu"]), stringValue(payload["nameOriginal"]), "KP "+kpID),
		OriginalTitle: fallbackOriginalTitle(stringValue(payload["nameRu"]), stringValue(payload["nameOriginal"])),
		Year:          normalizeValue(payload["year"]),
		RatingKP:      normalizeValue(payload["ratingKinopoisk"]),
		RatingIMDb:    normalizeValue(payload["ratingImdb"]),
		Duration:      durationValue(payload["filmLength"]),
		Poster:        firstNonEmpty(stringValue(payload["posterUrl"]), stringValue(payload["posterUrlPreview"])),
		Backdrop:      stringValue(payload["coverUrl"]),
		Description:   firstNonEmpty(stringValue(payload["description"]), stringValue(payload["shortDescription"])),
		Slogan:        stringValue(payload["slogan"]),
		Genres:        collectNamedList(payload["genres"], "genre"),
		Countries:     collectNamedList(payload["countries"], "country"),
		Type:          normalizeType(stringValue(payload["type"])),
	}

	if details.KPID == 0 {
		details.KPID = intValue(kpID)
	}
	return details, nil
}

func filmViaAlloha(ctx context.Context, kpID string) (filmDetails, error) {
	target := "https://api.alloha.tv/?token=" + url.QueryEscape(defaultAllohaToken) + "&kp=" + url.QueryEscape(kpID)
	var (
		body []byte
		err  error
	)
	for range 2 {
		body, err = fetchCachedUpstreamBytes(ctx, http.MethodGet, target, nil, http.Header{
			"Accept": []string{"application/json, text/plain, */*"},
		}, detailCacheTTL)
		if err == nil {
			break
		}
	}
	if err != nil {
		return filmDetails{}, err
	}

	var payload map[string]any
	if err := json.Unmarshal(body, &payload); err != nil {
		return filmDetails{}, err
	}
	if strings.EqualFold(stringValue(payload["status"]), "error") {
		return filmDetails{}, providerResolutionError("alloha-film", payload)
	}

	data, _ := payload["data"].(map[string]any)
	if data == nil {
		return filmDetails{}, fmt.Errorf("alloha-film: empty data")
	}

	details := filmDetails{
		KPID:          intValue(data["id_kp"]),
		Title:         firstNonEmpty(stringValue(data["name"]), stringValue(data["original_name"]), "KP "+kpID),
		OriginalTitle: fallbackOriginalTitle(stringValue(data["name"]), stringValue(data["original_name"])),
		Year:          normalizeValue(data["year"]),
		RatingKP:      normalizeValue(data["rating_kp"]),
		RatingIMDb:    normalizeValue(data["rating_imdb"]),
		Duration:      firstNonEmpty(stringValue(data["time"]), durationValue(data["time"])),
		Poster:        stringValue(data["poster"]),
		Description:   stringValue(data["description"]),
		Slogan:        stringValue(data["tagline"]),
		Genres:        splitCSV(stringValue(data["genre"])),
		Countries:     splitCSV(stringValue(data["country"])),
		Type:          allohaType(data),
	}

	if details.KPID == 0 {
		details.KPID = intValue(kpID)
	}
	return details, nil
}

func handlePlayer(w http.ResponseWriter, r *http.Request) {
	kpID := strings.TrimSpace(r.URL.Query().Get("kp"))
	provider := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("provider")))
	if provider == "" {
		provider = "alloha"
	}
	if kpID == "" {
		writeError(w, http.StatusBadRequest, "Не передан Kinopoisk ID", "")
		return
	}

	var (
		playerURL string
		err       error
	)

	switch provider {
	case "alloha":
		playerURL, err = resolveAlloha(r.Context(), kpID)
	case "collaps":
		playerURL, err = resolveCollaps(r.Context(), kpID)
	default:
		writeError(w, http.StatusBadRequest, "Неизвестный провайдер", provider)
		return
	}

	if err != nil {
		writeError(w, http.StatusBadGateway, "Не удалось получить iframe плеера", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, playerPayload{
		Provider:  provider,
		PlayerURL: playerURL,
		Direct:    true,
	})

	go saveHistoryByKPID(context.Background(), kpID, provider)
}

func handleHistory(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		limit := envIntOrDefault("LIBRARY_HISTORY_LIMIT", 50)
		items, err := getLibraryItems(r.Context(), libraryHistoryIndexKey(), libraryHistoryItemsKey(), limit)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось загрузить историю", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": items,
			"count": len(items),
		})
	case http.MethodDelete:
		if err := clearLibraryBucket(r.Context(), libraryHistoryIndexKey(), libraryHistoryItemsKey()); err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось очистить историю", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleFavorites(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		items, err := getLibraryItems(r.Context(), libraryFavoritesIndexKey(), libraryFavoritesItemsKey(), 200)
		if err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось загрузить избранное", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{
			"items": items,
			"count": len(items),
		})
	case http.MethodPost:
		var req struct {
			KPID     int    `json:"kpId"`
			Provider string `json:"provider"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Некорректный JSON", err.Error())
			return
		}
		if req.KPID == 0 {
			writeError(w, http.StatusBadRequest, "Не передан kpId", "")
			return
		}
		item, err := buildLibraryItem(r.Context(), strconv.Itoa(req.KPID), req.Provider)
		if err != nil {
			writeError(w, http.StatusBadGateway, "Не удалось добавить в избранное", err.Error())
			return
		}
		if err := saveFavorite(r.Context(), item); err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось сохранить избранное", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "item": item})
	case http.MethodDelete:
		kpID := strings.TrimSpace(r.URL.Query().Get("kp"))
		if kpID == "" {
			writeError(w, http.StatusBadRequest, "Не передан kp", "")
			return
		}
		if err := removeFavorite(r.Context(), kpID); err != nil {
			writeError(w, http.StatusInternalServerError, "Не удалось удалить из избранного", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func resolveAlloha(ctx context.Context, kpID string) (string, error) {
	target := "https://api.alloha.tv/?token=" + url.QueryEscape(defaultAllohaToken) + "&kp=" + url.QueryEscape(kpID)
	body, err := fetchCachedUpstreamBytes(ctx, http.MethodGet, target, nil, http.Header{
		"Accept": []string{"application/json, text/plain, */*"},
	}, upstreamCacheTTL)
	if err != nil {
		return "", err
	}

	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("alloha: %w", err)
	}

	playerURL := absoluteURL(pickString(payload, []any{"data", "iframe"}, []any{"iframe"}), target)
	if playerURL == "" {
		return "", providerResolutionError("alloha", payload)
	}
	return playerURL, nil
}

func resolveCollaps(ctx context.Context, kpID string) (string, error) {
	target := "https://api.bhcesh.me/franchise/details?token=" + url.QueryEscape(defaultCollapsToken) + "&kinopoisk_id=" + url.QueryEscape(kpID)
	body, err := fetchCachedUpstreamBytes(ctx, http.MethodGet, target, nil, http.Header{
		"Accept": []string{"application/json"},
	}, upstreamCacheTTL)
	if err != nil {
		return "", err
	}

	var payload any
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("collaps: %w", err)
	}

	playerURL := absoluteURL(
		pickString(
			payload,
			[]any{"iframe_url"},
			[]any{"iframe"},
			[]any{"data", "iframe_url"},
			[]any{"data", "iframe"},
			[]any{"results", 0, "iframe_url"},
			[]any{"results", 0, "iframe"},
		),
		target,
	)
	if playerURL == "" {
		return "", providerResolutionError("collaps", payload)
	}
	return playerURL, nil
}

func saveHistoryByKPID(ctx context.Context, kpID, provider string) {
	if !redisEnabled || strings.TrimSpace(kpID) == "" {
		return
	}
	item, err := buildLibraryItem(ctx, kpID, provider)
	if err != nil {
		log.Printf("history skip %s: %v", kpID, err)
		return
	}
	if err := saveHistory(ctx, item); err != nil {
		log.Printf("history save %s: %v", kpID, err)
	}
}

func buildLibraryItem(ctx context.Context, kpID, provider string) (libraryItem, error) {
	details, err := filmViaKinopoisk(ctx, kpID)
	if err != nil || details.Title == "" {
		details, err = filmViaAlloha(ctx, kpID)
	}
	if err != nil {
		return libraryItem{}, err
	}
	return libraryItem{
		KPID:          details.KPID,
		Title:         details.Title,
		OriginalTitle: details.OriginalTitle,
		Year:          details.Year,
		Rating:        firstNonEmpty(details.RatingKP, details.RatingIMDb),
		Poster:        normalizePosterURL(details.Poster),
		Type:          details.Type,
		Provider:      strings.TrimSpace(provider),
		Timestamp:     time.Now().UTC().Format(time.RFC3339),
	}, nil
}

func proxyHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Range, If-Range, If-Modified-Since, If-None-Match, X-API-KEY, X-Requested-With")
		w.Header().Set("Access-Control-Max-Age", "3600")
		w.WriteHeader(http.StatusNoContent)
		return
	}

	target := strings.TrimSpace(r.URL.Query().Get("url"))
	if target == "" {
		http.Error(w, "missing url param", http.StatusBadRequest)
		return
	}

	parsed, err := url.Parse(target)
	host := ""
	if err == nil {
		host = parsed.Hostname()
	}
	if err != nil || host == "" || !isAllowed(host) {
		log.Printf("[proxy] BLOCKED domain=%q url=%s", host, target)
		http.Error(w, "domain not allowed", http.StatusForbidden)
		return
	}

	var requestBody io.Reader
	if r.Method != http.MethodGet && r.Method != http.MethodHead && r.Body != nil {
		bodyBytes, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		requestBody = bytes.NewReader(bodyBytes)
	}

	reqHeaders := http.Header{}
	copyHeaderSubset(reqHeaders, r.Header, []string{
		"Accept", "Accept-Language", "Authorization", "Content-Type",
		"If-Modified-Since", "If-None-Match", "If-Range", "Origin",
		"Range", "Referer", "User-Agent", "X-API-KEY", "X-Requested-With",
	})

	resp, err := doUpstreamRequest(r.Context(), r.Method, target, requestBody, reqHeaders)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	contentType := resp.Header.Get("Content-Type")
	isHTML := strings.Contains(contentType, "text/html")

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	if isHTML && !isJSONAPIHost(host) {
		responseBody = processPlayerHTML(responseBody, parsed)
	}

	copyHeaderSubset(w.Header(), resp.Header, []string{
		"Accept-Ranges", "Cache-Control", "Content-Disposition",
		"Content-Range", "ETag", "Expires", "Last-Modified", "Vary",
	})

	if contentType != "" {
		if isHTML && !strings.Contains(contentType, "charset") {
			contentType += "; charset=utf-8"
		}
		w.Header().Set("Content-Type", contentType)
	}
	w.Header().Set("Content-Length", strconv.Itoa(len(responseBody)))
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, DELETE, OPTIONS")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Range, If-Range, If-Modified-Since, If-None-Match, X-API-KEY, X-Requested-With")
	w.Header().Set("Access-Control-Max-Age", "86400")
	w.Header().Del("Content-Security-Policy")
	w.Header().Del("X-Frame-Options")
	w.Header().Del("X-Content-Type-Options")

	w.WriteHeader(resp.StatusCode)
	if r.Method != http.MethodHead {
		_, _ = w.Write(responseBody)
	}
}

func processPlayerHTML(body []byte, baseURL *url.URL) []byte {
	body = cspMetaRe.ReplaceAll(body, nil)
	body = integrityAttrRe.ReplaceAll(body, nil)

	baseURLJSON, _ := json.Marshal(baseURL.String())
	inject := fmt.Sprintf(proxyPatchScriptTpl, string(baseURLJSON)) + fmt.Sprintf(`<base href=%s>`, string(baseURLJSON))

	if loc := headTagRe.FindIndex(body); loc != nil {
		out := make([]byte, 0, len(body)+len(inject))
		out = append(out, body[:loc[1]]...)
		out = append(out, []byte(inject)...)
		out = append(out, body[loc[1]:]...)
		return out
	}
	return append([]byte(inject), body...)
}

func fetchUpstreamBytes(ctx context.Context, method, target string, body io.Reader, headers http.Header) ([]byte, error) {
	resp, err := doUpstreamRequest(ctx, method, target, body, headers)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	responseBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("upstream %d: %s", resp.StatusCode, strings.TrimSpace(string(responseBody)))
	}
	return responseBody, nil
}

func fetchCachedUpstreamBytes(ctx context.Context, method, target string, body io.Reader, headers http.Header, ttl time.Duration) ([]byte, error) {
	if method != http.MethodGet || !redisEnabled || ttl <= 0 {
		return fetchUpstreamBytes(ctx, method, target, body, headers)
	}

	cacheKey := cacheKeyFor("upstream", method+"|"+target)
	if cached, ok := redisGetBytes(ctx, cacheKey); ok {
		return cached, nil
	}

	responseBody, err := fetchUpstreamBytes(ctx, method, target, body, headers)
	if err != nil {
		return nil, err
	}
	redisSetBytes(ctx, cacheKey, responseBody, ttl)
	return responseBody, nil
}

func doUpstreamRequest(ctx context.Context, method, target string, body io.Reader, headers http.Header) (*http.Response, error) {
	parsed, err := url.Parse(target)
	if err != nil {
		return nil, err
	}
	host := parsed.Hostname()
	if host == "" {
		return nil, fmt.Errorf("empty host")
	}

	req, err := http.NewRequestWithContext(ctx, method, target, body)
	if err != nil {
		return nil, err
	}

	copyHeaderSubset(req.Header, headers, []string{
		"Accept", "Accept-Language", "Authorization", "Content-Type",
		"If-Modified-Since", "If-None-Match", "If-Range", "Origin",
		"Range", "Referer", "User-Agent", "X-API-KEY", "X-Requested-With",
	})

	if req.Header.Get("User-Agent") == "" {
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36")
	}
	if req.Header.Get("Accept-Language") == "" {
		req.Header.Set("Accept-Language", "ru-RU,ru;q=0.9,en;q=0.8")
	}
	if req.Header.Get("Accept") == "" {
		if isKinopoiskAPI(host) || isJSONAPIHost(host) {
			req.Header.Set("Accept", "application/json, text/plain, */*")
		} else {
			req.Header.Set("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,video/mp4,*/*;q=0.8")
		}
	}

	if isKinopoiskImageHost(host) {
		req.Header.Del("Referer")
		req.Header.Del("Origin")
	}

	if shouldSpoofReferer(host) && req.Header.Get("Referer") == "" {
		referer := refererForHost(host)
		req.Header.Set("Referer", referer)
		if req.Header.Get("Origin") == "" {
			req.Header.Set("Origin", strings.TrimSuffix(referer, "/"))
		}
	}

	resp, err := newHTTPClient(host, shouldSkipTLSVerify(host)).Do(req)
	if err != nil {
		return nil, err
	}
	return resp, nil
}

func newHTTPClient(host string, skipTLSVerify bool) *http.Client {
	transport := &http.Transport{
		TLSClientConfig: &tls.Config{InsecureSkipVerify: skipTLSVerify},
		Proxy:           proxyFuncForHost(host),
	}

	return &http.Client{
		Transport: transport,
		Jar:       upstreamCookieJar,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if shouldSpoofReferer(req.URL.Hostname()) {
				referer := refererForHost(req.URL.Hostname())
				req.Header.Set("Referer", referer)
				req.Header.Set("Origin", strings.TrimSuffix(referer, "/"))
			}
			return nil
		},
		Timeout: 45 * time.Second,
	}
}

func isAllowed(host string) bool {
	allowed := []string{
		"alloha.tv", "api.alloha.tv", "api.bhcesh.me", "api.zenithjs.ws",
		"apicollaps.cc", "cdn.jsdelivr.net", "distribrey.com", "img.imgilall.me",
		"imasdk.googleapis.com", "interkh.com", "kinopoiskapiunofficial.tech",
		"kp.yandex.net", "st.kp.yandex.net", "avatars.mds.yandex.net",
		"stloadi.live", "unpkg.com",
	}
	for _, item := range allowed {
		if host == item || strings.HasSuffix(host, "."+item) {
			return true
		}
	}
	return false
}

func isKinopoiskAPI(host string) bool {
	return host == "kinopoiskapiunofficial.tech" || strings.HasSuffix(host, ".kinopoiskapiunofficial.tech")
}

func isJSONAPIHost(host string) bool {
	switch {
	case isKinopoiskAPI(host):
		return true
	case host == "api.alloha.tv" || strings.HasSuffix(host, ".api.alloha.tv"):
		return true
	case host == "api.bhcesh.me" || strings.HasSuffix(host, ".api.bhcesh.me"):
		return true
	default:
		return false
	}
}

func shouldSpoofReferer(host string) bool {
	if isKinopoiskImageHost(host) {
		return false
	}
	return !isJSONAPIHost(host)
}

func shouldSkipTLSVerify(host string) bool {
	return host == "api.alloha.tv" || strings.HasSuffix(host, ".api.alloha.tv")
}

func isKinopoiskImageHost(host string) bool {
	switch {
	case host == "st.kp.yandex.net" || strings.HasSuffix(host, ".st.kp.yandex.net"):
		return true
	case host == "kp.yandex.net" || strings.HasSuffix(host, ".kp.yandex.net"):
		return true
	case host == "avatars.mds.yandex.net" || strings.HasSuffix(host, ".avatars.mds.yandex.net"):
		return true
	case host == "kinopoiskapiunofficial.tech" || strings.HasSuffix(host, ".kinopoiskapiunofficial.tech"):
		return true
	default:
		return false
	}
}

func refererForHost(host string) string {
	switch {
	case host == "stloadi.live" || strings.HasSuffix(host, ".stloadi.live"):
		return "https://api.alloha.tv/"
	default:
		return defaultReferer
	}
}

func shouldUseRUProxy(host string) bool {
	switch {
	case host == "api.alloha.tv" || strings.HasSuffix(host, ".api.alloha.tv"):
		return true
	case host == "stloadi.live" || strings.HasSuffix(host, ".stloadi.live"):
		return true
	default:
		return false
	}
}

func proxyFuncForHost(host string) func(*http.Request) (*url.URL, error) {
	proxyURL := strings.TrimSpace(os.Getenv("ALLOHA_UPSTREAM_PROXY_URL"))
	if proxyURL == "" || !shouldUseRUProxy(host) {
		return nil
	}
	parsed, err := url.Parse(proxyURL)
	if err != nil {
		log.Printf("[proxy] invalid ALLOHA_UPSTREAM_PROXY_URL: %v", err)
		return nil
	}
	return http.ProxyURL(parsed)
}

func providerResolutionError(provider string, payload any) error {
	message := pickString(payload, []any{"message"}, []any{"error"}, []any{"msg"}, []any{"detail"}, []any{"name"})
	if message == "" {
		raw, _ := json.Marshal(payload)
		message = string(raw)
	}
	return fmt.Errorf("%s: %s", provider, message)
}

func pickString(data any, paths ...[]any) string {
	for _, path := range paths {
		if value := lookup(data, path...); value != nil {
			switch v := value.(type) {
			case string:
				if s := strings.TrimSpace(v); s != "" {
					return s
				}
			case json.Number:
				if s := v.String(); s != "" {
					return s
				}
			case fmt.Stringer:
				if s := strings.TrimSpace(v.String()); s != "" {
					return s
				}
			case float64:
				return strconv.FormatFloat(v, 'f', -1, 64)
			case int:
				return strconv.Itoa(v)
			}
		}
	}
	return ""
}

func lookup(data any, path ...any) any {
	current := data
	for _, part := range path {
		switch key := part.(type) {
		case string:
			node, ok := current.(map[string]any)
			if !ok {
				return nil
			}
			current = node[key]
		case int:
			node, ok := current.([]any)
			if !ok || key < 0 || key >= len(node) {
				return nil
			}
			current = node[key]
		default:
			return nil
		}
	}
	return current
}

func collectNamedList(value any, key string) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(items))
	for _, item := range items {
		if node, ok := item.(map[string]any); ok {
			if text := strings.TrimSpace(stringValue(node[key])); text != "" {
				out = append(out, text)
			}
		}
	}
	return out
}

func collectSearchGenres(items []struct {
	Genre string `json:"genre"`
}) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text := strings.TrimSpace(item.Genre); text != "" {
			out = append(out, text)
		}
	}
	return out
}

func collectSearchCountries(items []struct {
	Country string `json:"country"`
}) []string {
	out := make([]string, 0, len(items))
	for _, item := range items {
		if text := strings.TrimSpace(item.Country); text != "" {
			out = append(out, text)
		}
	}
	return out
}

func copyHeaderSubset(dst, src http.Header, keys []string) {
	for _, key := range keys {
		values := src.Values(key)
		if len(values) == 0 {
			continue
		}
		dst.Del(key)
		for _, value := range values {
			dst.Add(key, value)
		}
	}
}

func mustCookieJar() http.CookieJar {
	jar, err := cookiejar.New(nil)
	if err != nil {
		panic(err)
	}
	return jar
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil && !errors.Is(err, io.EOF) {
		log.Printf("writeJSON: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message, details string) {
	writeJSON(w, status, appError{Error: message, Details: details})
}

func stringValue(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case json.Number:
		return v.String()
	case float64:
		if v == float64(int64(v)) {
			return strconv.FormatInt(int64(v), 10)
		}
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	case int64:
		return strconv.FormatInt(v, 10)
	default:
		return ""
	}
}

func intValue(value any) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case string:
		i, _ := strconv.Atoi(strings.TrimSpace(v))
		return i
	case json.Number:
		i, _ := strconv.Atoi(v.String())
		return i
	default:
		return 0
	}
}

func normalizeValue(value any) string {
	text := stringValue(value)
	if text == "" || text == "null" || text == "0" {
		return ""
	}
	return text
}

func durationValue(value any) string {
	switch v := value.(type) {
	case float64:
		if v > 0 {
			return fmt.Sprintf("%d мин", int(v))
		}
	case int:
		if v > 0 {
			return fmt.Sprintf("%d мин", v)
		}
	case string:
		v = strings.TrimSpace(v)
		if v != "" && v != "0" {
			return v
		}
	}
	return ""
}

func normalizeType(value string) string {
	switch strings.TrimSpace(strings.ToLower(value)) {
	case "tv-series":
		return "series"
	default:
		return strings.TrimSpace(value)
	}
}

func allohaType(data map[string]any) string {
	switch intValue(data["category"]) {
	case 2:
		return "series"
	default:
		return "film"
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func fallbackOriginalTitle(primary, original string) string {
	primary = strings.TrimSpace(primary)
	original = strings.TrimSpace(original)
	if primary == "" || original == "" || primary == original {
		return ""
	}
	return original
}

func absoluteURL(rawURL, baseURL string) string {
	rawURL = strings.TrimSpace(rawURL)
	if rawURL == "" {
		return ""
	}
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return ""
	}
	if parsed.IsAbs() {
		return parsed.String()
	}
	base, err := url.Parse(baseURL)
	if err != nil {
		return ""
	}
	return base.ResolveReference(parsed).String()
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func envIntOrDefault(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	parts := strings.Split(value, ",")
	out := make([]string, 0, len(parts))
	for _, part := range parts {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func normalizePosterURL(value string) string {
	return strings.TrimSpace(value)
}

func cacheKeyFor(scope, raw string) string {
	sum := sha1.Sum([]byte(raw))
	return "cinema:" + scope + ":" + hex.EncodeToString(sum[:])
}

func redisGetBytes(ctx context.Context, key string) ([]byte, bool) {
	if !redisEnabled || redisClient == nil {
		return nil, false
	}
	value, err := redisClient.Get(ctx, key).Bytes()
	if err == redis.Nil {
		return nil, false
	}
	if err != nil {
		log.Printf("redis get %s: %v", key, err)
		return nil, false
	}
	return value, true
}

func redisSetBytes(ctx context.Context, key string, value []byte, ttl time.Duration) {
	if !redisEnabled || redisClient == nil {
		return
	}
	if err := redisClient.Set(ctx, key, value, ttl).Err(); err != nil {
		log.Printf("redis set %s: %v", key, err)
	}
}

func libraryPrefix() string {
	return "cinema:library:" + defaultLibraryUser
}

func libraryHistoryIndexKey() string {
	return libraryPrefix() + ":history:index"
}

func libraryHistoryItemsKey() string {
	return libraryPrefix() + ":history:items"
}

func libraryFavoritesIndexKey() string {
	return libraryPrefix() + ":favorites:index"
}

func libraryFavoritesItemsKey() string {
	return libraryPrefix() + ":favorites:items"
}

func saveHistory(ctx context.Context, item libraryItem) error {
	return upsertLibraryItem(ctx, libraryHistoryIndexKey(), libraryHistoryItemsKey(), item, 100)
}

func saveFavorite(ctx context.Context, item libraryItem) error {
	return upsertLibraryItem(ctx, libraryFavoritesIndexKey(), libraryFavoritesItemsKey(), item, 500)
}

func upsertLibraryItem(ctx context.Context, indexKey, itemsKey string, item libraryItem, maxItems int64) error {
	if !redisEnabled || redisClient == nil {
		return nil
	}
	if item.KPID == 0 {
		return fmt.Errorf("empty kpId")
	}
	item.Timestamp = time.Now().UTC().Format(time.RFC3339)
	body, err := json.Marshal(item)
	if err != nil {
		return err
	}
	member := strconv.Itoa(item.KPID)
	score := float64(time.Now().Unix())
	pipe := redisClient.TxPipeline()
	pipe.HSet(ctx, itemsKey, member, body)
	pipe.ZAdd(ctx, indexKey, redis.Z{Score: score, Member: member})
	if maxItems > 0 {
		pipe.ZRemRangeByRank(ctx, indexKey, 0, -(maxItems + 1))
	}
	_, err = pipe.Exec(ctx)
	return err
}

func removeFavorite(ctx context.Context, kpID string) error {
	if !redisEnabled || redisClient == nil {
		return nil
	}
	pipe := redisClient.TxPipeline()
	pipe.ZRem(ctx, libraryFavoritesIndexKey(), kpID)
	pipe.HDel(ctx, libraryFavoritesItemsKey(), kpID)
	_, err := pipe.Exec(ctx)
	return err
}

func clearLibraryBucket(ctx context.Context, indexKey, itemsKey string) error {
	if !redisEnabled || redisClient == nil {
		return nil
	}
	return redisClient.Del(ctx, indexKey, itemsKey).Err()
}

func getLibraryItems(ctx context.Context, indexKey, itemsKey string, limit int) ([]libraryItem, error) {
	if !redisEnabled || redisClient == nil {
		return []libraryItem{}, nil
	}
	if limit <= 0 {
		limit = 50
	}
	ids, err := redisClient.ZRevRange(ctx, indexKey, 0, int64(limit-1)).Result()
	if err != nil {
		return nil, err
	}
	if len(ids) == 0 {
		return []libraryItem{}, nil
	}
	values, err := redisClient.HMGet(ctx, itemsKey, ids...).Result()
	if err != nil {
		return nil, err
	}
	items := make([]libraryItem, 0, len(values))
	for _, value := range values {
		raw, ok := value.(string)
		if !ok || raw == "" {
			continue
		}
		var item libraryItem
		if err := json.Unmarshal([]byte(raw), &item); err == nil {
			items = append(items, item)
		}
	}
	return items, nil
}
