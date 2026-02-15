package api

import (
	"fmt"
	"log"
	"time"

	"eve-flipper/internal/db"
)

const (
	// DefaultAlertCooldownSeconds is the minimum time between repeat alerts for the same item/metric/threshold.
	DefaultAlertCooldownSeconds = 3600 // 1 hour
)

// AlertCheckResult describes whether an alert should be sent and contains necessary metadata.
type AlertCheckResult struct {
	ShouldAlert    bool
	TypeID         int32
	TypeName       string
	Metric         string
	Threshold      float64
	CurrentValue   float64
	Message        string
	CooldownActive bool
	LastAlertAt    time.Time
}

// CheckWatchlistAlerts evaluates watchlist items against scan results and determines which alerts to fire.
// Returns list of alerts that should be sent (respecting cooldown and deduplication).
func (s *Server) CheckWatchlistAlerts(results interface{}) []AlertCheckResult {
	watchlist := s.db.GetWatchlist()
	var alerts []AlertCheckResult

	for _, item := range watchlist {
		if !item.AlertEnabled {
			continue
		}

		metric := item.AlertMetric
		if metric == "" {
			metric = "margin_percent"
		}
		threshold := item.AlertThreshold
		if threshold <= 0 {
			threshold = item.AlertMinMargin
		}
		if threshold <= 0 {
			continue // no valid threshold
		}

		// Extract current value from results based on type
		currentValue, typeName, ok := s.extractMetricValue(item.TypeID, metric, results)
		if !ok {
			continue // item not found in results
		}

		// Check if threshold is met
		if currentValue < threshold {
			continue
		}

		// Check cooldown (deduplication)
		lastAlertTime, err := s.db.GetLastAlertTime(item.TypeID, metric, threshold)
		if err != nil {
			log.Printf("[ALERT] Error checking last alert time for type %d: %v", item.TypeID, err)
			continue
		}

		cooldownActive := false
		if !lastAlertTime.IsZero() {
			elapsed := time.Since(lastAlertTime)
			if elapsed < DefaultAlertCooldownSeconds*time.Second {
				cooldownActive = true
				log.Printf("[ALERT] Cooldown active for %s (last alert: %v ago)", typeName, elapsed.Round(time.Second))
				continue
			}
		}

		// Generate alert message
		message := s.formatAlertMessage(typeName, metric, threshold, currentValue)

		alerts = append(alerts, AlertCheckResult{
			ShouldAlert:    true,
			TypeID:         item.TypeID,
			TypeName:       typeName,
			Metric:         metric,
			Threshold:      threshold,
			CurrentValue:   currentValue,
			Message:        message,
			CooldownActive: cooldownActive,
			LastAlertAt:    lastAlertTime,
		})
	}

	return alerts
}

// SendAlert sends an alert via configured channels and records it in history.
func (s *Server) SendAlert(alert AlertCheckResult, scanID *int64) error {
	// Send via configured channels
	result := s.sendConfiguredExternalAlerts(alert.Message)

	// Record in history
	channelsSent := result.Sent
	channelsFailed := result.Failed

	// Always include desktop as sent (frontend will show toast)
	if s.cfg.AlertDesktop {
		channelsSent = append(channelsSent, "desktop")
	}

	entry := db.AlertHistoryEntry{
		WatchlistTypeID: alert.TypeID,
		TypeName:        alert.TypeName,
		AlertMetric:     alert.Metric,
		AlertThreshold:  alert.Threshold,
		CurrentValue:    alert.CurrentValue,
		Message:         alert.Message,
		ChannelsSent:    channelsSent,
		ChannelsFailed:  channelsFailed,
		SentAt:          time.Now().UTC().Format(time.RFC3339),
		ScanID:          scanID,
	}

	if err := s.db.SaveAlertHistory(entry); err != nil {
		log.Printf("[ALERT] Failed to save alert history: %v", err)
		// Don't fail the alert send if history save fails
	}

	log.Printf("[ALERT] Sent alert for %s: %s (channels: %v)", alert.TypeName, alert.Message, channelsSent)
	return nil
}

// extractMetricValue extracts the current value for a given metric from scan results.
// Supports FlipResult, StationTrade, ContractResult, etc.
func (s *Server) extractMetricValue(typeID int32, metric string, results interface{}) (float64, string, bool) {
	// Try to cast results to different types
	switch r := results.(type) {
	case []FlipResult:
		for _, item := range r {
			if item.TypeID == typeID {
				value := extractFlipMetric(item, metric)
				return value, item.TypeName, true
			}
		}
	case []StationTrade:
		for _, item := range r {
			if item.TypeID == typeID {
				value := extractStationMetric(item, metric)
				return value, item.TypeName, true
			}
		}
	case []ContractResult:
		// Contracts don't have type_id, skip for now
		return 0, "", false
	default:
		log.Printf("[ALERT] Unknown result type: %T", results)
		return 0, "", false
	}
	return 0, "", false
}

func extractFlipMetric(item FlipResult, metric string) float64 {
	switch metric {
	case "margin_percent":
		return item.MarginPercent
	case "total_profit":
		return item.TotalProfit
	case "profit_per_unit":
		return item.ProfitPerUnit
	case "daily_volume":
		return float64(item.DailyVolume)
	default:
		return 0
	}
}

func extractStationMetric(item StationTrade, metric string) float64 {
	switch metric {
	case "margin_percent":
		return item.MarginPct
	case "total_profit":
		return item.Margin * float64(item.Volume)
	case "profit_per_unit":
		return item.Margin
	case "daily_volume":
		return item.BuyVolume + item.SellVolume // approximation
	default:
		return 0
	}
}

func (s *Server) formatAlertMessage(typeName, metric string, threshold, current float64) string {
	metricLabel := metric
	switch metric {
	case "margin_percent":
		metricLabel = "Margin"
		return fmt.Sprintf("%s: %s %.2f%% >= %.2f%%", typeName, metricLabel, current, threshold)
	case "total_profit":
		metricLabel = "Total Profit"
		return fmt.Sprintf("%s: %s %.0f ISK >= %.0f ISK", typeName, metricLabel, current, threshold)
	case "profit_per_unit":
		metricLabel = "Profit/Unit"
		return fmt.Sprintf("%s: %s %.0f ISK >= %.0f ISK", typeName, metricLabel, current, threshold)
	case "daily_volume":
		metricLabel = "Daily Volume"
		return fmt.Sprintf("%s: %s %.0f >= %.0f", typeName, metricLabel, current, threshold)
	default:
		return fmt.Sprintf("%s: %s %.2f >= %.2f", typeName, metric, current, threshold)
	}
}

// FlipResult is duplicated here to avoid import cycle (should be in engine package).
// This is a temporary workaround.
type FlipResult struct {
	TypeID         int32
	TypeName       string
	MarginPercent  float64
	TotalProfit    float64
	ProfitPerUnit  float64
	DailyVolume    int64
	BuyPrice       float64
	SellPrice      float64
	UnitsToBuy     int32
	BuyStation     string
	SellStation    string
	BuySystemName  string
	SellSystemName string
}

// StationTrade is duplicated here to avoid import cycle.
type StationTrade struct {
	TypeID     int32
	TypeName   string
	BuyPrice   float64
	SellPrice  float64
	Margin     float64
	MarginPct  float64
	Volume     float64
	BuyVolume  float64
	SellVolume float64
}

// ContractResult is duplicated here to avoid import cycle.
type ContractResult struct {
	ContractID    int32
	Title         string
	Price         float64
	MarketValue   float64
	Profit        float64
	MarginPercent float64
}
