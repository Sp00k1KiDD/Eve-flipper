package db

import (
	"database/sql"
	"testing"
	"time"

	"eve-flipper/internal/config"
)

func TestAlertHistory_SaveAndRetrieve(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	// Add a watchlist item first
	db.AddWatchlistItem(config.WatchlistItem{
		TypeID:         34,
		TypeName:       "Tritanium",
		AddedAt:        time.Now().UTC().Format(time.RFC3339),
		AlertEnabled:   true,
		AlertMetric:    "margin_percent",
		AlertThreshold: 10.0,
	})

	// Save alert history
	entry := AlertHistoryEntry{
		WatchlistTypeID: 34,
		TypeName:        "Tritanium",
		AlertMetric:     "margin_percent",
		AlertThreshold:  10.0,
		CurrentValue:    15.5,
		Message:         "Tritanium: margin 15.5% >= 10%",
		ChannelsSent:    []string{"telegram", "desktop"},
		ChannelsFailed:  map[string]string{"discord": "webhook failed"},
		SentAt:          time.Now().UTC().Format(time.RFC3339),
	}

	if err := db.SaveAlertHistory(entry); err != nil {
		t.Fatalf("SaveAlertHistory failed: %v", err)
	}

	// Retrieve history
	history, err := db.GetAlertHistory(34, 0)
	if err != nil {
		t.Fatalf("GetAlertHistory failed: %v", err)
	}

	if len(history) != 1 {
		t.Fatalf("expected 1 history entry, got %d", len(history))
	}

	h := history[0]
	if h.WatchlistTypeID != 34 {
		t.Errorf("expected type_id=34, got %d", h.WatchlistTypeID)
	}
	if h.AlertMetric != "margin_percent" {
		t.Errorf("expected metric=margin_percent, got %s", h.AlertMetric)
	}
	if h.CurrentValue != 15.5 {
		t.Errorf("expected current_value=15.5, got %f", h.CurrentValue)
	}
	if len(h.ChannelsSent) != 2 {
		t.Errorf("expected 2 channels sent, got %d", len(h.ChannelsSent))
	}
	if len(h.ChannelsFailed) != 1 {
		t.Errorf("expected 1 channel failed, got %d", len(h.ChannelsFailed))
	}
}

func TestAlertHistory_GetLastAlertTime(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	// Add watchlist item
	db.AddWatchlistItem(config.WatchlistItem{
		TypeID:         35,
		TypeName:       "Pyerite",
		AddedAt:        time.Now().UTC().Format(time.RFC3339),
		AlertEnabled:   true,
		AlertMetric:    "total_profit",
		AlertThreshold: 1000000,
	})

	// No alert sent yet
	lastTime, err := db.GetLastAlertTime(35, "total_profit", 1000000)
	if err != nil {
		t.Fatalf("GetLastAlertTime failed: %v", err)
	}
	if !lastTime.IsZero() {
		t.Errorf("expected zero time for no alerts, got %v", lastTime)
	}

	// Send alert
	sentAt := time.Now().UTC().Add(-30 * time.Minute)
	db.SaveAlertHistory(AlertHistoryEntry{
		WatchlistTypeID: 35,
		TypeName:        "Pyerite",
		AlertMetric:     "total_profit",
		AlertThreshold:  1000000,
		CurrentValue:    1500000,
		Message:         "test",
		ChannelsSent:    []string{"desktop"},
		SentAt:          sentAt.Format(time.RFC3339),
	})

	// Retrieve last alert time
	lastTime, err = db.GetLastAlertTime(35, "total_profit", 1000000)
	if err != nil {
		t.Fatalf("GetLastAlertTime failed: %v", err)
	}

	diff := lastTime.Sub(sentAt).Abs()
	if diff > 1*time.Second {
		t.Errorf("expected last alert time ~%v, got %v (diff: %v)", sentAt, lastTime, diff)
	}
}

func TestAlertHistory_CascadeDelete(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	// Add watchlist item and alert
	db.AddWatchlistItem(config.WatchlistItem{
		TypeID:         36,
		TypeName:       "Mexallon",
		AddedAt:        time.Now().UTC().Format(time.RFC3339),
		AlertEnabled:   true,
		AlertMetric:    "margin_percent",
		AlertThreshold: 5.0,
	})

	db.SaveAlertHistory(AlertHistoryEntry{
		WatchlistTypeID: 36,
		TypeName:        "Mexallon",
		AlertMetric:     "margin_percent",
		AlertThreshold:  5.0,
		CurrentValue:    8.0,
		Message:         "test",
		ChannelsSent:    []string{"desktop"},
		SentAt:          time.Now().UTC().Format(time.RFC3339),
	})

	// Verify alert exists
	history, _ := db.GetAlertHistory(36, 0)
	if len(history) != 1 {
		t.Fatalf("expected 1 alert, got %d", len(history))
	}

	// Delete watchlist item (should cascade delete alert_history)
	db.DeleteWatchlistItem(36)

	// Verify alert is deleted
	history, _ = db.GetAlertHistory(36, 0)
	if len(history) != 0 {
		t.Errorf("expected 0 alerts after cascade delete, got %d", len(history))
	}
}

func TestAlertHistory_CleanupOld(t *testing.T) {
	db := setupTestDB(t)
	defer db.Close()

	db.AddWatchlistItem(config.WatchlistItem{
		TypeID:         37,
		TypeName:       "Isogen",
		AddedAt:        time.Now().UTC().Format(time.RFC3339),
		AlertEnabled:   true,
		AlertMetric:    "margin_percent",
		AlertThreshold: 10.0,
	})

	// Add old alert (8 days ago)
	oldTime := time.Now().UTC().AddDate(0, 0, -8)
	db.SaveAlertHistory(AlertHistoryEntry{
		WatchlistTypeID: 37,
		TypeName:        "Isogen",
		AlertMetric:     "margin_percent",
		AlertThreshold:  10.0,
		CurrentValue:    12.0,
		Message:         "old alert",
		ChannelsSent:    []string{"desktop"},
		SentAt:          oldTime.Format(time.RFC3339),
	})

	// Add recent alert (1 day ago)
	recentTime := time.Now().UTC().AddDate(0, 0, -1)
	db.SaveAlertHistory(AlertHistoryEntry{
		WatchlistTypeID: 37,
		TypeName:        "Isogen",
		AlertMetric:     "margin_percent",
		AlertThreshold:  10.0,
		CurrentValue:    13.0,
		Message:         "recent alert",
		ChannelsSent:    []string{"desktop"},
		SentAt:          recentTime.Format(time.RFC3339),
	})

	// Cleanup alerts older than 7 days
	deleted, err := db.CleanupOldAlertHistory(7)
	if err != nil {
		t.Fatalf("CleanupOldAlertHistory failed: %v", err)
	}
	if deleted != 1 {
		t.Errorf("expected 1 deleted row, got %d", deleted)
	}

	// Verify only recent alert remains
	history, _ := db.GetAlertHistory(37, 0)
	if len(history) != 1 {
		t.Fatalf("expected 1 alert remaining, got %d", len(history))
	}
	if history[0].Message != "recent alert" {
		t.Errorf("expected recent alert to remain, got: %s", history[0].Message)
	}
}

// setupTestDB is a helper for tests (assumes db_test.go already has this or similar).
// If not, you can implement a minimal version here.
func setupTestDB(t *testing.T) *DB {
	t.Helper()
	// Use in-memory SQLite for tests with foreign keys enabled
	sqlDB, err := sql.Open("sqlite", ":memory:?_pragma=foreign_keys(1)")
	if err != nil {
		t.Fatalf("failed to open test db: %v", err)
	}
	db := &DB{sql: sqlDB}
	if err := db.migrate(); err != nil {
		t.Fatalf("failed to migrate test db: %v", err)
	}
	return db
}
