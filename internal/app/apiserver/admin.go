package apiserver

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
)

func handleAdminStats(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if !dbEnabled() {
		writeError(w, http.StatusServiceUnavailable, "База данных недоступна", "")
		return
	}
	stats, err := adminStats(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Не удалось загрузить статистику", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, stats)
}

func handleAdminUsers(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if !dbEnabled() {
		writeError(w, http.StatusServiceUnavailable, "База данных недоступна", "")
		return
	}
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	users, err := listUsers(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Не удалось загрузить пользователей", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": users, "count": len(users)})
}

func handleAdminUser(w http.ResponseWriter, r *http.Request) {
	admin, ok := requireAdmin(w, r)
	if !ok {
		return
	}
	if !dbEnabled() {
		writeError(w, http.StatusServiceUnavailable, "База данных недоступна", "")
		return
	}
	id, err := parseIDFromPath(r.URL.Path, "/api/admin/users/")
	if err != nil {
		writeError(w, http.StatusBadRequest, "Не передан id", err.Error())
		return
	}

	switch r.Method {
	case http.MethodPatch, http.MethodPut:
		var req struct {
			Role string `json:"role"`
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			writeError(w, http.StatusBadRequest, "Некорректный JSON", err.Error())
			return
		}
		if err := updateUserRole(r.Context(), id, req.Role); err != nil {
			status := http.StatusBadRequest
			if errors.Is(err, sql.ErrNoRows) {
				status = http.StatusNotFound
			}
			writeError(w, status, "Не удалось обновить роль", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	case http.MethodDelete:
		if id == admin.ID {
			writeError(w, http.StatusBadRequest, "Нельзя удалить себя", "")
			return
		}
		if err := deleteUser(r.Context(), id); err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, sql.ErrNoRows) {
				status = http.StatusNotFound
			}
			writeError(w, status, "Не удалось удалить пользователя", err.Error())
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"ok": true})
	default:
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
	}
}

func handleAdminLibrary(w http.ResponseWriter, r *http.Request) {
	if _, ok := requireAdmin(w, r); !ok {
		return
	}
	if !dbEnabled() {
		writeError(w, http.StatusServiceUnavailable, "База данных недоступна", "")
		return
	}
	kind := r.URL.Query().Get("type")
	if kind != "history" {
		kind = "favorites"
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	items, err := adminLibrary(r.Context(), kind, limit)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "Не удалось загрузить библиотеку", err.Error())
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "count": len(items), "type": kind})
}
