package db

import (
	"database/sql"
	"testing"

	"eve-flipper/internal/config"
	"eve-flipper/internal/engine"

	_ "modernc.org/sqlite"
)

// openTestDB opens an in-memory SQLite DB and runs migrations (for testing only).
func openTestDB(t *testing.T) *DB {
	t.Helper()
	sqlDB, err := sql.Open("sqlite", ":memory:?_pragma=journal_mode(WAL)&_pragma=busy_timeout(5000)")
	if err != nil {
		t.Fatalf("open in-memory db: %v", err)
	}
	d := &DB{sql: sqlDB}
	if err := d.migrate(); err != nil {
		sqlDB.Close()
		t.Fatalf("migrate: %v", err)
	}
	return d
}

func TestDB_MigrateAndHistoryRoundTrip(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	id := d.InsertHistory("radius", "Jita", 10, 1_500_000.5)
	if id <= 0 {
		t.Fatal("InsertHistory returned 0")
	}

	records := d.GetHistory(5)
	if len(records) != 1 {
		t.Fatalf("GetHistory(5) len = %d, want 1", len(records))
	}
	if records[0].ID != id {
		t.Errorf("GetHistory ID = %d, want %d", records[0].ID, id)
	}
	if records[0].Tab != "radius" || records[0].System != "Jita" {
		t.Errorf("Tab/System = %q/%q, want radius/Jita", records[0].Tab, records[0].System)
	}
	if records[0].Count != 10 {
		t.Errorf("Count = %d, want 10", records[0].Count)
	}
	if records[0].TopProfit != 1_500_000.5 {
		t.Errorf("TopProfit = %v, want 1500000.5", records[0].TopProfit)
	}
}

func TestDB_FlipResultsRoundTrip(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	id := d.InsertHistory("radius", "Jita", 1, 100)
	if id <= 0 {
		t.Fatal("InsertHistory failed")
	}

	results := []engine.FlipResult{
		{
			TypeID: 100, TypeName: "Test Item",
			BuyPrice: 90, SellPrice: 100,
			ProfitPerUnit: 10, MarginPercent: 11.11,
			UnitsToBuy: 50, TotalProfit: 500,
			BuyStation: "A", SellStation: "B",
			BuySystemName: "Sys1", SellSystemName: "Sys2",
			BuySystemID: 1, SellSystemID: 2,
			BuyOrderRemain: 100, SellOrderRemain: 200,
			ProfitPerJump: 100, BuyJumps: 1, SellJumps: 2, TotalJumps: 3,
		},
	}
	d.InsertFlipResults(id, results)

	got := d.GetFlipResults(id)
	if len(got) != 1 {
		t.Fatalf("GetFlipResults len = %d, want 1", len(got))
	}
	r := got[0]
	if r.TypeID != 100 || r.TypeName != "Test Item" {
		t.Errorf("TypeID/TypeName = %d/%q", r.TypeID, r.TypeName)
	}
	if r.BuyPrice != 90 || r.SellPrice != 100 {
		t.Errorf("Buy/Sell = %v/%v", r.BuyPrice, r.SellPrice)
	}
	if r.ProfitPerUnit != 10 || r.TotalProfit != 500 {
		t.Errorf("ProfitPerUnit/TotalProfit = %v/%v", r.ProfitPerUnit, r.TotalProfit)
	}
	if r.UnitsToBuy != 50 {
		t.Errorf("UnitsToBuy = %d", r.UnitsToBuy)
	}
}

func TestDB_StationResultsRoundTrip_WithExecutionFields(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	id := d.InsertHistory("station", "The Forge", 1, 10_000_000)
	if id <= 0 {
		t.Fatal("InsertHistory failed")
	}

	in := []engine.StationTrade{
		{
			TypeID:            34,
			TypeName:          "Tritanium",
			BuyPrice:          5.0,
			SellPrice:         5.4,
			Spread:            0.4,
			MarginPercent:     7.5,
			DailyVolume:       120000,
			BuyVolume:         80000,
			SellVolume:        90000,
			StationID:         60003760,
			StationName:       "Jita IV - Moon 4 - Caldari Navy Assembly Plant",
			CTS:               62.3,
			SDS:               12,
			PeriodROI:         18.1,
			VWAP:              5.2,
			PVI:               6.8,
			OBDS:              1.4,
			BvSRatio:          0.9,
			DOS:               2.2,
			DailyProfit:       1450000,
			RealProfit:        1400000,
			FilledQty:         40000,
			CanFill:           true,
			ExpectedProfit:    35.0,
			ExpectedBuyPrice:  5.1,
			ExpectedSellPrice: 5.45,
			SlippageBuyPct:    0.2,
			SlippageSellPct:   0.15,
		},
	}
	d.InsertStationResults(id, in)

	got := d.GetStationResults(id)
	if len(got) != 1 {
		t.Fatalf("GetStationResults len = %d, want 1", len(got))
	}

	r := got[0]
	if r.DailyProfit != in[0].DailyProfit {
		t.Errorf("DailyProfit = %v, want %v", r.DailyProfit, in[0].DailyProfit)
	}
	if r.RealProfit != in[0].RealProfit {
		t.Errorf("RealProfit = %v, want %v", r.RealProfit, in[0].RealProfit)
	}
	if r.FilledQty != in[0].FilledQty {
		t.Errorf("FilledQty = %d, want %d", r.FilledQty, in[0].FilledQty)
	}
	if r.CanFill != in[0].CanFill {
		t.Errorf("CanFill = %v, want %v", r.CanFill, in[0].CanFill)
	}
	if r.ExpectedProfit != in[0].ExpectedProfit {
		t.Errorf("ExpectedProfit = %v, want %v", r.ExpectedProfit, in[0].ExpectedProfit)
	}
}

func TestDB_Migrate_StationResultsHasExecutionColumns(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	rows, err := d.sql.Query("PRAGMA table_info(station_results)")
	if err != nil {
		t.Fatalf("PRAGMA table_info(station_results): %v", err)
	}
	defer rows.Close()

	have := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan pragma row: %v", err)
		}
		have[name] = true
	}

	wantCols := []string{
		"daily_profit",
		"real_profit",
		"filled_qty",
		"can_fill",
		"expected_profit",
		"expected_buy_price",
		"expected_sell_price",
		"slippage_buy_pct",
		"slippage_sell_pct",
	}
	for _, col := range wantCols {
		if !have[col] {
			t.Errorf("station_results missing column %q", col)
		}
	}
}

func TestDB_ContractResultsRoundTrip_WithLongHorizonFields(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	id := d.InsertHistory("contracts", "Jita", 1, 5_000_000)
	in := []engine.ContractResult{
		{
			ContractID:            12345,
			Title:                 "Test Contract",
			Price:                 1_000_000_000,
			MarketValue:           1_300_000_000,
			Profit:                200_000_000,
			MarginPercent:         20,
			ExpectedProfit:        120_000_000,
			ExpectedMarginPercent: 12,
			SellConfidence:        86.5,
			EstLiquidationDays:    6.2,
			ConservativeValue:     1_130_000_000,
			CarryCost:             7_000_000,
			Volume:                12000,
			StationName:           "Jita IV - Moon 4",
			ItemCount:             12,
			Jumps:                 0,
			ProfitPerJump:         0,
		},
	}
	d.InsertContractResults(id, in)
	got := d.GetContractResults(id)
	if len(got) != 1 {
		t.Fatalf("GetContractResults len = %d, want 1", len(got))
	}
	r := got[0]
	if r.ExpectedProfit != in[0].ExpectedProfit {
		t.Errorf("ExpectedProfit = %v, want %v", r.ExpectedProfit, in[0].ExpectedProfit)
	}
	if r.SellConfidence != in[0].SellConfidence {
		t.Errorf("SellConfidence = %v, want %v", r.SellConfidence, in[0].SellConfidence)
	}
	if r.EstLiquidationDays != in[0].EstLiquidationDays {
		t.Errorf("EstLiquidationDays = %v, want %v", r.EstLiquidationDays, in[0].EstLiquidationDays)
	}
}

func TestDB_Migrate_ContractResultsHasLongHorizonColumns(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	rows, err := d.sql.Query("PRAGMA table_info(contract_results)")
	if err != nil {
		t.Fatalf("PRAGMA table_info(contract_results): %v", err)
	}
	defer rows.Close()

	have := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan pragma row: %v", err)
		}
		have[name] = true
	}

	wantCols := []string{
		"expected_profit",
		"expected_margin_percent",
		"sell_confidence",
		"est_liquidation_days",
		"conservative_value",
		"carry_cost",
	}
	for _, col := range wantCols {
		if !have[col] {
			t.Errorf("contract_results missing column %q", col)
		}
	}
}

func TestDB_GetHistoryByID(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	id := d.InsertHistory("contracts", "Amarr", 5, 2_000_000)
	rec := d.GetHistoryByID(id)
	if rec == nil {
		t.Fatal("GetHistoryByID returned nil")
	}
	if rec.ID != id || rec.System != "Amarr" || rec.Count != 5 {
		t.Errorf("record = %+v", rec)
	}

	if d.GetHistoryByID(99999) != nil {
		t.Error("GetHistoryByID(99999) should return nil")
	}
}

func TestDB_InsertFlipResults_ZeroScanIDNoOp(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	d.InsertFlipResults(0, []engine.FlipResult{{TypeID: 1}})
	got := d.GetFlipResults(0)
	if len(got) != 0 {
		t.Errorf("InsertFlipResults(0, ...) should not insert; GetFlipResults(0) len = %d", len(got))
	}
}

func TestDB_ConfigRoundTrip(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	cfg := &config.Config{
		SystemName:          "Amarr",
		CargoCapacity:       8000,
		BuyRadius:           7,
		SellRadius:          12,
		MinMargin:           10,
		SalesTaxPercent:     6,
		AlertTelegram:       true,
		AlertDiscord:        true,
		AlertDesktop:        false,
		AlertTelegramToken:  "tg-token",
		AlertTelegramChatID: "123456",
		AlertDiscordWebhook: "https://discord.example/webhook",
		Opacity:             200,
		WindowW:             1024,
		WindowH:             768,
	}
	if err := d.SaveConfig(cfg); err != nil {
		t.Fatalf("SaveConfig: %v", err)
	}
	got := d.LoadConfig()
	if got.SystemName != cfg.SystemName || got.CargoCapacity != cfg.CargoCapacity {
		t.Errorf("LoadConfig = SystemName %q CargoCapacity %v", got.SystemName, got.CargoCapacity)
	}
	if got.BuyRadius != 7 || got.SellRadius != 12 || got.MinMargin != 10 || got.SalesTaxPercent != 6 {
		t.Errorf("LoadConfig radii/margin/tax = %d %d %v %v", got.BuyRadius, got.SellRadius, got.MinMargin, got.SalesTaxPercent)
	}
	if !got.AlertTelegram || !got.AlertDiscord || got.AlertDesktop {
		t.Errorf("LoadConfig alerts = telegram=%v discord=%v desktop=%v", got.AlertTelegram, got.AlertDiscord, got.AlertDesktop)
	}
	if got.AlertTelegramToken != "tg-token" || got.AlertTelegramChatID != "123456" || got.AlertDiscordWebhook != "https://discord.example/webhook" {
		t.Errorf("LoadConfig alert credentials mismatch: token=%q chat=%q webhook=%q", got.AlertTelegramToken, got.AlertTelegramChatID, got.AlertDiscordWebhook)
	}
	if got.WindowW != 1024 || got.WindowH != 768 {
		t.Errorf("LoadConfig window = %dx%d", got.WindowW, got.WindowH)
	}
}

func TestDB_DemandRegionRoundTrip(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	r := &DemandRegion{
		RegionID:      10000033,
		RegionName:    "Tash-Murkon",
		HotScore:      1.5,
		Status:        "hot",
		KillsToday:    100,
		KillsBaseline: 50,
		ISKDestroyed:  2e11,
		ActivePlayers: 200,
		TopShips:      []string{"Ship A", "Ship B"},
	}
	if err := d.SaveDemandRegion(r); err != nil {
		t.Fatalf("SaveDemandRegion: %v", err)
	}
	list, err := d.GetDemandRegions()
	if err != nil {
		t.Fatalf("GetDemandRegions: %v", err)
	}
	if len(list) != 1 {
		t.Fatalf("GetDemandRegions len = %d, want 1", len(list))
	}
	if list[0].RegionID != r.RegionID || list[0].RegionName != r.RegionName || list[0].HotScore != r.HotScore {
		t.Errorf("GetDemandRegions[0] = %+v", list[0])
	}
	if len(list[0].TopShips) != 2 || list[0].TopShips[0] != "Ship A" {
		t.Errorf("TopShips = %v", list[0].TopShips)
	}

	one, err := d.GetDemandRegion(10000033)
	if err != nil || one == nil {
		t.Fatalf("GetDemandRegion(10000033): %v", err)
	}
	if one.RegionName != "Tash-Murkon" || one.ISKDestroyed != 2e11 {
		t.Errorf("GetDemandRegion = %+v", one)
	}
}

func TestDB_DemandRegion_NotFound(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()
	got, err := d.GetDemandRegion(99999)
	if err != nil {
		t.Errorf("GetDemandRegion(99999) err = %v (API returns nil,nil for no rows)", err)
	}
	if got != nil {
		t.Error("GetDemandRegion(99999) should return nil region")
	}
}

func TestDB_Migrate_WatchlistHasAlertModelColumns(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	rows, err := d.sql.Query("PRAGMA table_info(watchlist)")
	if err != nil {
		t.Fatalf("PRAGMA table_info(watchlist): %v", err)
	}
	defer rows.Close()

	have := map[string]bool{}
	for rows.Next() {
		var cid int
		var name, typ string
		var notNull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &typ, &notNull, &dflt, &pk); err != nil {
			t.Fatalf("scan pragma row: %v", err)
		}
		have[name] = true
	}

	wantCols := []string{"alert_enabled", "alert_metric", "alert_threshold"}
	for _, col := range wantCols {
		if !have[col] {
			t.Errorf("watchlist missing column %q", col)
		}
	}
}

func TestDB_WatchlistAlertSettingsRoundTrip(t *testing.T) {
	d := openTestDB(t)
	defer d.Close()

	inserted := d.AddWatchlistItem(config.WatchlistItem{
		TypeID:         34,
		TypeName:       "Tritanium",
		AddedAt:        "2026-02-13T00:00:00Z",
		AlertEnabled:   true,
		AlertMetric:    "total_profit",
		AlertThreshold: 2_500_000,
	})
	if !inserted {
		t.Fatal("AddWatchlistItem returned false")
	}

	items := d.GetWatchlist()
	if len(items) != 1 {
		t.Fatalf("GetWatchlist len = %d, want 1", len(items))
	}
	if !items[0].AlertEnabled || items[0].AlertMetric != "total_profit" || items[0].AlertThreshold != 2_500_000 {
		t.Fatalf("watchlist row mismatch after insert: %+v", items[0])
	}

	d.UpdateWatchlistItem(34, 0, true, "daily_volume", 1000)
	items = d.GetWatchlist()
	if len(items) != 1 {
		t.Fatalf("GetWatchlist len after update = %d, want 1", len(items))
	}
	if !items[0].AlertEnabled || items[0].AlertMetric != "daily_volume" || items[0].AlertThreshold != 1000 {
		t.Fatalf("watchlist row mismatch after update: %+v", items[0])
	}
}
