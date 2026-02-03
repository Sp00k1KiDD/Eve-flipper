package db

import (
	"eve-flipper/internal/engine"
	"log"
)

// InsertFlipResults bulk-inserts flip results linked to a scan history record.
func (d *DB) InsertFlipResults(scanID int64, results []engine.FlipResult) {
	if scanID == 0 || len(results) == 0 {
		return
	}

	tx, err := d.sql.Begin()
	if err != nil {
		log.Printf("[DB] InsertFlipResults begin tx: %v", err)
		return
	}

	stmt, err := tx.Prepare(`INSERT INTO flip_results (
		scan_id, type_id, type_name, volume,
		buy_price, buy_station, buy_system_name, buy_system_id,
		sell_price, sell_station, sell_system_name, sell_system_id,
		profit_per_unit, margin_percent, units_to_buy,
		buy_order_remain, sell_order_remain,
		total_profit, profit_per_jump, buy_jumps, sell_jumps, total_jumps
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		tx.Rollback()
		log.Printf("[DB] InsertFlipResults prepare: %v", err)
		return
	}
	defer stmt.Close()

	for _, r := range results {
		stmt.Exec(
			scanID, r.TypeID, r.TypeName, r.Volume,
			r.BuyPrice, r.BuyStation, r.BuySystemName, r.BuySystemID,
			r.SellPrice, r.SellStation, r.SellSystemName, r.SellSystemID,
			r.ProfitPerUnit, r.MarginPercent, r.UnitsToBuy,
			r.BuyOrderRemain, r.SellOrderRemain,
			r.TotalProfit, r.ProfitPerJump, r.BuyJumps, r.SellJumps, r.TotalJumps,
		)
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[DB] InsertFlipResults commit: %v", err)
	}
}

// GetFlipResults retrieves flip results for a scan.
func (d *DB) GetFlipResults(scanID int64) []engine.FlipResult {
	rows, err := d.sql.Query(`
		SELECT type_id, type_name, volume,
			buy_price, buy_station, buy_system_name, buy_system_id,
			sell_price, sell_station, sell_system_name, sell_system_id,
			profit_per_unit, margin_percent, units_to_buy,
			buy_order_remain, sell_order_remain,
			total_profit, profit_per_jump, buy_jumps, sell_jumps, total_jumps
		FROM flip_results WHERE scan_id = ?
	`, scanID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var results []engine.FlipResult
	for rows.Next() {
		var r engine.FlipResult
		rows.Scan(
			&r.TypeID, &r.TypeName, &r.Volume,
			&r.BuyPrice, &r.BuyStation, &r.BuySystemName, &r.BuySystemID,
			&r.SellPrice, &r.SellStation, &r.SellSystemName, &r.SellSystemID,
			&r.ProfitPerUnit, &r.MarginPercent, &r.UnitsToBuy,
			&r.BuyOrderRemain, &r.SellOrderRemain,
			&r.TotalProfit, &r.ProfitPerJump, &r.BuyJumps, &r.SellJumps, &r.TotalJumps,
		)
		results = append(results, r)
	}
	return results
}

// InsertContractResults bulk-inserts contract results linked to a scan history record.
func (d *DB) InsertContractResults(scanID int64, results []engine.ContractResult) {
	if scanID == 0 || len(results) == 0 {
		return
	}

	tx, err := d.sql.Begin()
	if err != nil {
		log.Printf("[DB] InsertContractResults begin tx: %v", err)
		return
	}

	stmt, err := tx.Prepare(`INSERT INTO contract_results (
		scan_id, contract_id, title, price, market_value,
		profit, margin_percent, volume, station_name,
		item_count, jumps, profit_per_jump
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		tx.Rollback()
		log.Printf("[DB] InsertContractResults prepare: %v", err)
		return
	}
	defer stmt.Close()

	for _, r := range results {
		stmt.Exec(
			scanID, r.ContractID, r.Title, r.Price, r.MarketValue,
			r.Profit, r.MarginPercent, r.Volume, r.StationName,
			r.ItemCount, r.Jumps, r.ProfitPerJump,
		)
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[DB] InsertContractResults commit: %v", err)
	}
}

// GetContractResults retrieves contract results for a scan.
func (d *DB) GetContractResults(scanID int64) []engine.ContractResult {
	rows, err := d.sql.Query(`
		SELECT contract_id, title, price, market_value,
			profit, margin_percent, volume, station_name,
			item_count, jumps, profit_per_jump
		FROM contract_results WHERE scan_id = ?
	`, scanID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var results []engine.ContractResult
	for rows.Next() {
		var r engine.ContractResult
		rows.Scan(
			&r.ContractID, &r.Title, &r.Price, &r.MarketValue,
			&r.Profit, &r.MarginPercent, &r.Volume, &r.StationName,
			&r.ItemCount, &r.Jumps, &r.ProfitPerJump,
		)
		results = append(results, r)
	}
	return results
}

// InsertStationResults bulk-inserts station trading results.
func (d *DB) InsertStationResults(scanID int64, results []engine.StationTrade) {
	if scanID == 0 || len(results) == 0 {
		return
	}

	tx, err := d.sql.Begin()
	if err != nil {
		log.Printf("[DB] InsertStationResults begin tx: %v", err)
		return
	}

	stmt, err := tx.Prepare(`INSERT INTO station_results (
		scan_id, type_id, type_name, buy_price, sell_price,
		margin, margin_pct, volume, buy_volume, sell_volume,
		station_id, station_name, cts, sds, period_roi,
		vwap, pvi, obds, bvs_ratio, dos
	) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
	if err != nil {
		tx.Rollback()
		log.Printf("[DB] InsertStationResults prepare: %v", err)
		return
	}
	defer stmt.Close()

	for _, r := range results {
		stmt.Exec(
			scanID, r.TypeID, r.TypeName, r.BuyPrice, r.SellPrice,
			r.Spread, r.MarginPercent, r.DailyVolume, r.BuyVolume, r.SellVolume,
			r.StationID, r.StationName, r.CTS, r.SDS, r.PeriodROI,
			r.VWAP, r.PVI, r.OBDS, r.BvSRatio, r.DOS,
		)
	}

	if err := tx.Commit(); err != nil {
		log.Printf("[DB] InsertStationResults commit: %v", err)
	}
}

// GetStationResults retrieves station trading results for a scan.
func (d *DB) GetStationResults(scanID int64) []engine.StationTrade {
	rows, err := d.sql.Query(`
		SELECT type_id, type_name, buy_price, sell_price,
			margin, margin_pct, volume, buy_volume, sell_volume,
			station_id, station_name, cts, sds, period_roi,
			vwap, pvi, obds, bvs_ratio, dos
		FROM station_results WHERE scan_id = ?
	`, scanID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var results []engine.StationTrade
	for rows.Next() {
		var r engine.StationTrade
		rows.Scan(
			&r.TypeID, &r.TypeName, &r.BuyPrice, &r.SellPrice,
			&r.Spread, &r.MarginPercent, &r.DailyVolume, &r.BuyVolume, &r.SellVolume,
			&r.StationID, &r.StationName, &r.CTS, &r.SDS, &r.PeriodROI,
			&r.VWAP, &r.PVI, &r.OBDS, &r.BvSRatio, &r.DOS,
		)
		results = append(results, r)
	}
	return results
}
