package apiserver

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	_ "github.com/lib/pq"
	"golang.org/x/crypto/bcrypt"
)

const (
	roleUser  = "user"
	roleAdmin = "admin"
)

var (
	postgresDB *sql.DB
	jwtKey     []byte
	jwtTTL     = 72 * time.Hour
)

type authUser struct {
	ID        int64  `json:"id"`
	Login     string `json:"login"`
	Email     string `json:"email"`
	Role      string `json:"role"`
	CreatedAt string `json:"createdAt,omitempty"`
}

type jwtClaims struct {
	UserID int64  `json:"uid"`
	Login  string `json:"login"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	jwt.RegisteredClaims
}

type authRequest struct {
	Login    string `json:"login"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

func initDatabase() error {
	secret := strings.TrimSpace(os.Getenv("JWT_SECRET"))
	if secret == "" {
		secret = "dev-change-me"
		log.Println("WARNING: JWT_SECRET not set; using dev fallback")
	}
	jwtKey = []byte(secret)

	databaseURL := strings.TrimSpace(os.Getenv("DATABASE_URL"))
	if databaseURL == "" {
		log.Println("Postgres off: DATABASE_URL empty")
		return nil
	}

	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(envIntOrDefault("DB_MAX_OPEN_CONNS", 10))
	db.SetMaxIdleConns(envIntOrDefault("DB_MAX_IDLE_CONNS", 5))
	db.SetConnMaxLifetime(30 * time.Minute)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return fmt.Errorf("postgres ping: %w", err)
	}

	postgresDB = db
	if err := runMigrations(ctx, db, envOrDefault("MIGRATIONS_DIR", "migrations")); err != nil {
		return err
	}
	if err := seedAdmin(ctx); err != nil {
		return err
	}

	log.Println("Postgres on")
	return nil
}

func dbEnabled() bool {
	return postgresDB != nil
}

func runMigrations(ctx context.Context, db *sql.DB, dir string) error {
	if _, err := db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version text PRIMARY KEY,
			applied_at timestamptz NOT NULL DEFAULT now()
		)
	`); err != nil {
		return fmt.Errorf("create schema_migrations: %w", err)
	}

	entries, err := os.ReadDir(dir)
	if err != nil {
		return fmt.Errorf("read migrations: %w", err)
	}
	sort.Slice(entries, func(i, j int) bool { return entries[i].Name() < entries[j].Name() })

	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".sql") {
			continue
		}
		version := strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name()))
		var exists bool
		if err := db.QueryRowContext(ctx, `SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, version).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}

		body, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return err
		}
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, string(body)); err != nil {
			_ = tx.Rollback()
			return fmt.Errorf("migration %s: %w", entry.Name(), err)
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO schema_migrations(version) VALUES($1)`, version); err != nil {
			_ = tx.Rollback()
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		log.Printf("migration applied: %s", entry.Name())
	}
	return nil
}

func seedAdmin(ctx context.Context) error {
	login := normalizeLogin(os.Getenv("ADMIN_LOGIN"))
	email := normalizeEmail(os.Getenv("ADMIN_EMAIL"))
	password := strings.TrimSpace(os.Getenv("ADMIN_PASSWORD"))
	if login == "" || password == "" {
		log.Println("WARNING: ADMIN_LOGIN/ADMIN_PASSWORD not set; admin seed skipped")
		return nil
	}
	if email == "" {
		email = login + "@local.invalid"
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	_, err = postgresDB.ExecContext(ctx, `
		INSERT INTO users (login, email, password_hash, role)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (login) DO UPDATE
		SET email = EXCLUDED.email,
		    password_hash = EXCLUDED.password_hash,
		    role = $4,
		    updated_at = now()
	`, login, email, string(hash), roleAdmin)
	return err
}

func handleRegister(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !dbEnabled() {
		writeError(w, http.StatusServiceUnavailable, "База данных недоступна", "")
		return
	}

	req, ok := decodeAuthRequest(w, r)
	if !ok {
		return
	}
	if len(req.Login) < 3 || !validEmail(req.Email) || len(req.Password) < 6 {
		writeError(w, http.StatusBadRequest, "Логин от 3 символов, корректный email, пароль от 6", "")
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Не удалось создать пароль", err.Error())
		return
	}

	user, err := createUser(r.Context(), req.Login, req.Email, string(hash), roleUser)
	if err != nil {
		writeError(w, http.StatusConflict, "Пользователь уже существует", err.Error())
		return
	}
	writeAuthResponse(w, user)
}

func handleLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if !dbEnabled() {
		writeError(w, http.StatusServiceUnavailable, "База данных недоступна", "")
		return
	}

	req, ok := decodeAuthRequest(w, r)
	if !ok {
		return
	}
	if !validEmail(req.Email) {
		writeError(w, http.StatusBadRequest, "Корректный email обязателен", "")
		return
	}

	user, hash, err := findUserWithHashByEmail(r.Context(), req.Email)
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
		writeError(w, http.StatusUnauthorized, "Неверный email или пароль", "")
		return
	}
	writeAuthResponse(w, user)
}

func handleMe(w http.ResponseWriter, r *http.Request) {
	user, ok := requireAuth(w, r)
	if !ok {
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": user})
}

func handleLogout(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func decodeAuthRequest(w http.ResponseWriter, r *http.Request) (authRequest, bool) {
	var req authRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "Некорректный JSON", err.Error())
		return authRequest{}, false
	}
	req.Login = normalizeLogin(req.Login)
	req.Email = normalizeEmail(firstNonEmpty(req.Email, req.Login))
	req.Password = strings.TrimSpace(req.Password)
	if req.Email == "" || req.Password == "" {
		writeError(w, http.StatusBadRequest, "Email и пароль обязательны", "")
		return authRequest{}, false
	}
	return req, true
}

func writeAuthResponse(w http.ResponseWriter, user authUser) {
	token, expiresAt, err := issueToken(user)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Не удалось выпустить токен", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"token":     token,
		"expiresAt": expiresAt.Format(time.RFC3339),
		"user":      user,
	})
}

func issueToken(user authUser) (string, time.Time, error) {
	expiresAt := time.Now().Add(jwtTTL)
	claims := jwtClaims{
		UserID: user.ID,
		Login:  user.Login,
		Email:  user.Email,
		Role:   user.Role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(user.ID, 10),
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	signed, err := token.SignedString(jwtKey)
	return signed, expiresAt, err
}

func currentUserFromRequest(r *http.Request) (*authUser, bool) {
	raw := strings.TrimSpace(r.Header.Get("Authorization"))
	if raw == "" {
		return nil, false
	}
	tokenText := strings.TrimSpace(strings.TrimPrefix(raw, "Bearer "))
	if tokenText == raw {
		return nil, false
	}

	token, err := jwt.ParseWithClaims(tokenText, &jwtClaims{}, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return jwtKey, nil
	})
	if err != nil || !token.Valid {
		return nil, false
	}
	claims, ok := token.Claims.(*jwtClaims)
	if !ok || claims.UserID == 0 {
		return nil, false
	}

	if dbEnabled() {
		user, err := findUserByID(r.Context(), claims.UserID)
		if err == nil {
			return &user, true
		}
	}
	return &authUser{ID: claims.UserID, Login: claims.Login, Email: claims.Email, Role: claims.Role}, true
}

func requireAuth(w http.ResponseWriter, r *http.Request) (*authUser, bool) {
	user, ok := currentUserFromRequest(r)
	if !ok {
		writeError(w, http.StatusUnauthorized, "Нужна авторизация", "")
		return nil, false
	}
	return user, true
}

func requireAdmin(w http.ResponseWriter, r *http.Request) (*authUser, bool) {
	user, ok := requireAuth(w, r)
	if !ok {
		return nil, false
	}
	if user.Role != roleAdmin {
		writeError(w, http.StatusForbidden, "Нужна роль admin", "")
		return nil, false
	}
	return user, true
}

func userIDOrZero(user *authUser) int64 {
	if user == nil {
		return 0
	}
	return user.ID
}

func createUser(ctx context.Context, login, email, hash, role string) (authUser, error) {
	var user authUser
	var createdAt time.Time
	err := postgresDB.QueryRowContext(ctx, `
		INSERT INTO users (login, email, password_hash, role)
		VALUES ($1, $2, $3, $4)
		RETURNING id, login, email, role, created_at
	`, login, email, hash, role).Scan(&user.ID, &user.Login, &user.Email, &user.Role, &createdAt)
	user.CreatedAt = createdAt.Format(time.RFC3339)
	return user, err
}

func findUserWithHashByEmail(ctx context.Context, email string) (authUser, string, error) {
	var user authUser
	var hash string
	var createdAt time.Time
	err := postgresDB.QueryRowContext(ctx, `
		SELECT id, login, email, role, password_hash, created_at
		FROM users
		WHERE email = $1
	`, email).Scan(&user.ID, &user.Login, &user.Email, &user.Role, &hash, &createdAt)
	user.CreatedAt = createdAt.Format(time.RFC3339)
	return user, hash, err
}

func findUserByID(ctx context.Context, id int64) (authUser, error) {
	var user authUser
	var createdAt time.Time
	err := postgresDB.QueryRowContext(ctx, `
		SELECT id, login, email, role, created_at
		FROM users
		WHERE id = $1
	`, id).Scan(&user.ID, &user.Login, &user.Email, &user.Role, &createdAt)
	user.CreatedAt = createdAt.Format(time.RFC3339)
	return user, err
}

func listUsers(ctx context.Context) ([]authUser, error) {
	rows, err := postgresDB.QueryContext(ctx, `
		SELECT id, login, email, role, created_at
		FROM users
		ORDER BY created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	users := []authUser{}
	for rows.Next() {
		var user authUser
		var createdAt time.Time
		if err := rows.Scan(&user.ID, &user.Login, &user.Email, &user.Role, &createdAt); err != nil {
			return nil, err
		}
		user.CreatedAt = createdAt.Format(time.RFC3339)
		users = append(users, user)
	}
	return users, rows.Err()
}

func normalizeLogin(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func validEmail(value string) bool {
	value = normalizeEmail(value)
	at := strings.Index(value, "@")
	return at > 0 && at < len(value)-3 && strings.Contains(value[at+1:], ".")
}

func updateUserRole(ctx context.Context, id int64, role string) error {
	if role != roleUser && role != roleAdmin {
		return fmt.Errorf("bad role")
	}
	res, err := postgresDB.ExecContext(ctx, `UPDATE users SET role = $1, updated_at = now() WHERE id = $2`, role, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func deleteUser(ctx context.Context, id int64) error {
	res, err := postgresDB.ExecContext(ctx, `DELETE FROM users WHERE id = $1`, id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return sql.ErrNoRows
	}
	return nil
}

func parseIDFromPath(path, prefix string) (int64, error) {
	raw := strings.Trim(strings.TrimPrefix(path, prefix), "/")
	if raw == "" {
		return 0, errors.New("missing id")
	}
	return strconv.ParseInt(raw, 10, 64)
}
