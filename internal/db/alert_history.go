package db

import (
	"database/sql"
	"encoding/json"
	"time"
)

// AlertHistoryEntry represents a sent alert notification.
type AlertHistoryEntry struct {
	ID              int64             `json:"id"`
	WatchlistTypeID int32             `json:"watchlist_type_id"`
	TypeName        string            `json:"type_name"`
	AlertMetric     string            `json:"alert_metric"`
	AlertThreshold  float64           `json:"alert_threshold"`
	CurrentValue    float64           `json:"current_value"`
	Message         string            `json:"message"`
	ChannelsSent    []string          `json:"channels_sent"`
	ChannelsFailed  map[string]string `json:"channels_failed,omitempty"`
	SentAt          string            `json:"sent_at"`
	ScanID          *int64            `json:"scan_id,omitempty"`
}

// SaveAlertHistory records a sent alert to the history table.
func (d *DB) SaveAlertHistory(entry AlertHistoryEntry) error {
	channelsSentJSON, _ := json.Marshal(entry.ChannelsSent)
	var channelsFailedJSON []byte
	if len(entry.ChannelsFailed) > 0 {
		channelsFailedJSON, _ = json.Marshal(entry.ChannelsFailed)
	}

	if entry.SentAt == "" {
		entry.SentAt = time.Now().UTC().Format(time.RFC3339)
	}

	_, err := d.sql.Exec(`
		INSERT INTO alert_history (
			watchlist_type_id, type_name, alert_metric, alert_threshold,
			current_value, message, channels_sent, channels_failed, sent_at, scan_id
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entry.WatchlistTypeID,
		entry.TypeName,
		entry.AlertMetric,
		entry.AlertThreshold,
		entry.CurrentValue,
		entry.Message,
		string(channelsSentJSON),
		string(channelsFailedJSON),
		entry.SentAt,
		entry.ScanID,
	)
	return err
}

// GetAlertHistory returns alert history with optional filters.
// If typeID is 0, returns all alerts. Limit controls max results (0 = unlimited).
func (d *DB) GetAlertHistory(typeID int32, limit int) ([]AlertHistoryEntry, error) {
	query := `
		SELECT id, watchlist_type_id, type_name, alert_metric, alert_threshold,
		       current_value, message, channels_sent, channels_failed, sent_at, scan_id
		  FROM alert_history
	`
	args := []interface{}{}
	if typeID > 0 {
		query += " WHERE watchlist_type_id = ?"
		args = append(args, typeID)
	}
	query += " ORDER BY sent_at DESC"
	if limit > 0 {
		query += " LIMIT ?"
		args = append(args, limit)
	}

	rows, err := d.sql.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var entries []AlertHistoryEntry
	for rows.Next() {
		var e AlertHistoryEntry
		var channelsSentStr, channelsFailedStr sql.NullString
		var scanID sql.NullInt64

		if err := rows.Scan(
			&e.ID,
			&e.WatchlistTypeID,
			&e.TypeName,
			&e.AlertMetric,
			&e.AlertThreshold,
			&e.CurrentValue,
			&e.Message,
			&channelsSentStr,
			&channelsFailedStr,
			&e.SentAt,
			&scanID,
		); err != nil {
			return nil, err
		}

		if channelsSentStr.Valid {
			json.Unmarshal([]byte(channelsSentStr.String), &e.ChannelsSent)
		}
		if channelsFailedStr.Valid {
			json.Unmarshal([]byte(channelsFailedStr.String), &e.ChannelsFailed)
		}
		if scanID.Valid {
			sid := scanID.Int64
			e.ScanID = &sid
		}

		entries = append(entries, e)
	}

	if entries == nil {
		return []AlertHistoryEntry{}, nil
	}
	return entries, nil
}

// GetLastAlertTime returns the timestamp of the last alert sent for a given watchlist item and metric.
// Returns zero time if no alert found.
func (d *DB) GetLastAlertTime(typeID int32, metric string, threshold float64) (time.Time, error) {
	var sentAt string
	err := d.sql.QueryRow(`
		SELECT sent_at FROM alert_history
		 WHERE watchlist_type_id = ? AND alert_metric = ? AND alert_threshold = ?
		 ORDER BY sent_at DESC
		 LIMIT 1
	`, typeID, metric, threshold).Scan(&sentAt)

	if err == sql.ErrNoRows {
		return time.Time{}, nil
	}
	if err != nil {
		return time.Time{}, err
	}

	t, err := time.Parse(time.RFC3339, sentAt)
	if err != nil {
		return time.Time{}, err
	}
	return t, nil
}

// DeleteAlertHistory removes alert history for a specific watchlist item.
// This is called automatically via ON DELETE CASCADE when watchlist item is deleted,
// but this method can be used for manual cleanup.
func (d *DB) DeleteAlertHistory(typeID int32) error {
	_, err := d.sql.Exec("DELETE FROM alert_history WHERE watchlist_type_id = ?", typeID)
	return err
}

// CleanupOldAlertHistory removes alert history older than the specified number of days.
func (d *DB) CleanupOldAlertHistory(olderThanDays int) (int64, error) {
	if olderThanDays <= 0 {
		return 0, nil
	}
	cutoff := time.Now().UTC().AddDate(0, 0, -olderThanDays).Format(time.RFC3339)
	res, err := d.sql.Exec("DELETE FROM alert_history WHERE sent_at < ?", cutoff)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}
