package engine

import "testing"

func TestEstimateSellUnitsPerDay_AllowsBvSBelowOne(t *testing.T) {
	daily := 100.0
	buyVol := int32(500)
	sellVol := int32(1000)

	sellPerDay := estimateSellUnitsPerDay(daily, buyVol, sellVol)
	if sellPerDay <= daily {
		t.Fatalf("sellPerDay = %v, want > %v", sellPerDay, daily)
	}

	bvs := daily / sellPerDay
	if bvs >= 1 {
		t.Fatalf("BvS = %v, want < 1", bvs)
	}
}

func TestEstimateSellUnitsPerDay_AllowsBvSAboveOne(t *testing.T) {
	daily := 100.0
	buyVol := int32(1000)
	sellVol := int32(500)

	sellPerDay := estimateSellUnitsPerDay(daily, buyVol, sellVol)
	if sellPerDay >= daily {
		t.Fatalf("sellPerDay = %v, want < %v", sellPerDay, daily)
	}

	bvs := daily / sellPerDay
	if bvs <= 1 {
		t.Fatalf("BvS = %v, want > 1", bvs)
	}
}

func TestStationExecutionDesiredQty(t *testing.T) {
	if got := stationExecutionDesiredQty(400, 1000, 300); got != 300 {
		t.Fatalf("desired qty with dailyShare cap = %d, want 300", got)
	}
	if got := stationExecutionDesiredQty(50, 40, 100); got != 40 {
		t.Fatalf("desired qty with depth cap = %d, want 40", got)
	}
	if got := stationExecutionDesiredQty(0, 5000, 8000); got != 1000 {
		t.Fatalf("fallback desired qty = %d, want 1000", got)
	}
	if got := stationExecutionDesiredQty(0, 0, 10); got != 0 {
		t.Fatalf("zero depth desired qty = %d, want 0", got)
	}
}
