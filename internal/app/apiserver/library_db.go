package apiserver

import (
	"context"
	"database/sql"
	"strconv"
	"time"
)

type adminLibraryItem struct {
	libraryItem
	UserID int64  `json:"userId"`
	Login  string `json:"login"`
}

func saveFavoriteItem(ctx context.Context, userID int64, item libraryItem) error {
	_, err := postgresDB.ExecContext(ctx, `
		INSERT INTO favorites (
			user_id, kp_id, provider, title, original_title, year, rating, poster, type, created_at, updated_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now(),now())
		ON CONFLICT (user_id, kp_id) DO UPDATE SET
			provider = EXCLUDED.provider,
			title = EXCLUDED.title,
			original_title = EXCLUDED.original_title,
			year = EXCLUDED.year,
			rating = EXCLUDED.rating,
			poster = EXCLUDED.poster,
			type = EXCLUDED.type,
			updated_at = now()
	`, userID, item.KPID, item.Provider, item.Title, item.OriginalTitle, item.Year, item.Rating, item.Poster, item.Type)
	return err
}

func getFavoriteItems(ctx context.Context, userID int64) ([]libraryItem, error) {
	rows, err := postgresDB.QueryContext(ctx, `
		SELECT kp_id, title, original_title, year, rating, poster, type, provider, updated_at
		FROM favorites
		WHERE user_id = $1
		ORDER BY updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLibraryItems(rows)
}

func removeFavoriteItem(ctx context.Context, userID int64, kpID string) error {
	_, err := postgresDB.ExecContext(ctx, `DELETE FROM favorites WHERE user_id = $1 AND kp_id = $2`, userID, kpID)
	return err
}

func saveHistoryItem(ctx context.Context, userID int64, item libraryItem) error {
	_, err := postgresDB.ExecContext(ctx, `
		INSERT INTO history (
			user_id, kp_id, provider, title, original_title, year, rating, poster, type, watched_at
		)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now())
	`, userID, item.KPID, item.Provider, item.Title, item.OriginalTitle, item.Year, item.Rating, item.Poster, item.Type)
	if err != nil {
		return err
	}
	_, err = postgresDB.ExecContext(ctx, `
		DELETE FROM history
		WHERE id IN (
			SELECT id FROM history
			WHERE user_id = $1
			ORDER BY watched_at DESC
			OFFSET 200
		)
	`, userID)
	return err
}

func getHistoryItems(ctx context.Context, userID int64, limit int) ([]libraryItem, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := postgresDB.QueryContext(ctx, `
		SELECT kp_id, title, original_title, year, rating, poster, type, provider, watched_at
		FROM history
		WHERE user_id = $1
		ORDER BY watched_at DESC
		LIMIT $2
	`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLibraryItems(rows)
}

func clearHistoryItems(ctx context.Context, userID int64) error {
	_, err := postgresDB.ExecContext(ctx, `DELETE FROM history WHERE user_id = $1`, userID)
	return err
}

func scanLibraryItems(rows *sql.Rows) ([]libraryItem, error) {
	items := []libraryItem{}
	for rows.Next() {
		var item libraryItem
		var ts time.Time
		if err := rows.Scan(&item.KPID, &item.Title, &item.OriginalTitle, &item.Year, &item.Rating, &item.Poster, &item.Type, &item.Provider, &ts); err != nil {
			return nil, err
		}
		item.Timestamp = ts.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, rows.Err()
}

func adminStats(ctx context.Context) (map[string]any, error) {
	stats := map[string]any{}
	var users, admins, favorites, history int
	if err := postgresDB.QueryRowContext(ctx, `SELECT count(*) FROM users`).Scan(&users); err != nil {
		return nil, err
	}
	if err := postgresDB.QueryRowContext(ctx, `SELECT count(*) FROM users WHERE role = $1`, roleAdmin).Scan(&admins); err != nil {
		return nil, err
	}
	if err := postgresDB.QueryRowContext(ctx, `SELECT count(*) FROM favorites`).Scan(&favorites); err != nil {
		return nil, err
	}
	if err := postgresDB.QueryRowContext(ctx, `SELECT count(*) FROM history`).Scan(&history); err != nil {
		return nil, err
	}
	stats["users"] = users
	stats["admins"] = admins
	stats["regularUsers"] = users - admins
	stats["favorites"] = favorites
	stats["history"] = history
	stats["providers"] = len(playerProviders)
	return stats, nil
}

func adminLibrary(ctx context.Context, kind string, limit int) ([]adminLibraryItem, error) {
	if limit <= 0 {
		limit = 100
	}
	table := "favorites"
	tsColumn := "f.updated_at"
	alias := "f"
	if kind == "history" {
		table = "history"
		tsColumn = "h.watched_at"
		alias = "h"
	}
	query := `
		SELECT ` + alias + `.user_id, u.login, ` + alias + `.kp_id, ` + alias + `.title, ` + alias + `.original_title,
		       ` + alias + `.year, ` + alias + `.rating, ` + alias + `.poster, ` + alias + `.type, ` + alias + `.provider, ` + tsColumn + `
		FROM ` + table + ` ` + alias + `
		JOIN users u ON u.id = ` + alias + `.user_id
		ORDER BY ` + tsColumn + ` DESC
		LIMIT $1
	`
	rows, err := postgresDB.QueryContext(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	items := []adminLibraryItem{}
	for rows.Next() {
		var item adminLibraryItem
		var ts time.Time
		if err := rows.Scan(
			&item.UserID,
			&item.Login,
			&item.KPID,
			&item.Title,
			&item.OriginalTitle,
			&item.Year,
			&item.Rating,
			&item.Poster,
			&item.Type,
			&item.Provider,
			&ts,
		); err != nil {
			return nil, err
		}
		item.Timestamp = ts.Format(time.RFC3339)
		items = append(items, item)
	}
	return items, rows.Err()
}

func kpIDString(id int) string {
	return strconv.Itoa(id)
}
