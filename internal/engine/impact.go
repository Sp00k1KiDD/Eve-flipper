package engine

import (
	"math"
	"sort"

	"eve-flipper/internal/esi"
)

// ImpactParams holds calibrated market impact parameters from history.
type ImpactParams struct {
	// Amihud: illiquidity ratio = median( |log-return| / volume ).
	// Units: fractional price change per unit. Higher = less liquid.
	Amihud float64 `json:"amihud"`
	// Sigma: daily volatility (sample std dev of log-returns).
	Sigma float64 `json:"sigma"`
	// SigmaSq: variance of daily log-returns.
	SigmaSq float64 `json:"sigma_sq"`
	// AvgDailyVolume: average daily trading volume over the calibration window.
	AvgDailyVolume float64 `json:"avg_daily_volume"`
	// DaysUsed is the number of history days used for calibration.
	DaysUsed int `json:"days_used"`
	// Valid is true if calibration succeeded (enough data).
	Valid bool `json:"valid"`
}

// ImpactEstimate is the result of applying the impact model for a given quantity.
type ImpactEstimate struct {
	// LinearImpactPct: Amihud linear estimate ΔP% = amihud × Q.
	LinearImpactPct float64 `json:"linear_impact_pct"`
	// SqrtImpactPct: square-root law ΔP% = σ × √(Q / V_daily).
	// Standard model from Barra/Almgren: impact scales with sqrt of participation rate.
	SqrtImpactPct float64 `json:"sqrt_impact_pct"`
	// RecommendedImpactPct: best estimate of price impact in %.
	RecommendedImpactPct float64 `json:"recommended_impact_pct"`
	// RecommendedImpactISK: recommended impact in ISK (using reference price).
	RecommendedImpactISK float64 `json:"recommended_impact_isk"`
	// OptimalSlices: suggested number of slices for TWAP execution.
	// Based on participation rate: each slice ≤ targetPct of daily volume.
	OptimalSlices int `json:"optimal_slices"`
	// Params used for this estimate.
	Params ImpactParams `json:"params"`
}

const (
	// DefaultImpactDays is the number of history days used for calibration.
	DefaultImpactDays = 30
	// DefaultTWAPHorizonDays is T in execution planning (kept for API compat).
	DefaultTWAPHorizonDays = 1
	// DefaultTWAPTargetPct is the max fraction of daily volume per slice (5%).
	DefaultTWAPTargetPct = 0.05
)

// CalibrateImpact calibrates impact parameters from market history.
//
// Amihud illiquidity: median( |log(P_i/P_{i-1})| / Volume_i ).
// Sigma: sample std dev of daily log-returns.
// AvgDailyVolume: mean daily volume over the window.
func CalibrateImpact(history []esi.HistoryEntry, days int) ImpactParams {
	entries := filterLastNDays(history, days)
	if len(entries) < 5 {
		return ImpactParams{}
	}

	var amihudValues []float64
	var logReturns []float64
	var prevAvg float64
	var totalVolume float64
	var volumeDays int

	for i, h := range entries {
		if h.Average <= 0 {
			continue
		}
		if h.Volume > 0 {
			totalVolume += float64(h.Volume)
			volumeDays++
		}
		if i > 0 && prevAvg > 0 && h.Volume > 0 {
			logRet := math.Log(h.Average / prevAvg)
			logReturns = append(logReturns, logRet)
			// Amihud: |log-return| / volume
			amihudValues = append(amihudValues, math.Abs(logRet)/float64(h.Volume))
		}
		prevAvg = h.Average
	}

	out := ImpactParams{DaysUsed: len(entries)}
	if len(amihudValues) < 3 || len(logReturns) < 2 {
		return out
	}

	out.Amihud = median(amihudValues)
	out.SigmaSq = variance(logReturns)
	out.Sigma = math.Sqrt(out.SigmaSq)
	if volumeDays > 0 {
		out.AvgDailyVolume = totalVolume / float64(volumeDays)
	}
	out.Valid = true
	return out
}

func median(x []float64) float64 {
	if len(x) == 0 {
		return 0
	}
	sorted := make([]float64, len(x))
	copy(sorted, x)
	sort.Float64s(sorted)
	n := len(sorted)
	if n%2 == 1 {
		return sorted[n/2]
	}
	return (sorted[n/2-1] + sorted[n/2]) / 2
}

func variance(x []float64) float64 {
	if len(x) < 2 {
		return 0
	}
	var sum float64
	for _, v := range x {
		sum += v
	}
	mean := sum / float64(len(x))
	var sq float64
	for _, v := range x {
		d := v - mean
		sq += d * d
	}
	return sq / float64(len(x)-1) // Bessel's correction: unbiased sample variance
}

// ImpactLinearPct returns estimated price impact (%) using Amihud linear model.
// ΔP% = amihud × Q. Best for small orders (Q << daily volume).
func ImpactLinearPct(amihud float64, quantity float64) float64 {
	if quantity <= 0 || amihud <= 0 {
		return 0
	}
	return amihud * quantity * 100 // convert fractional to %
}

// ImpactSqrtPct returns estimated price impact (%) using the square-root law.
// ΔP% = σ × √(Q / V_daily) × 100.
// Standard model: impact proportional to volatility × sqrt of participation rate.
// Best for larger orders where impact is concave in quantity.
func ImpactSqrtPct(sigma float64, quantity float64, avgDailyVolume float64) float64 {
	if quantity <= 0 || sigma <= 0 || avgDailyVolume <= 0 {
		return 0
	}
	return sigma * math.Sqrt(quantity/avgDailyVolume) * 100
}

// OptimalSlicesVolume computes the optimal number of TWAP slices based on
// participation rate: each slice should not exceed targetPct of daily volume.
//
//	n* = ceil(Q / (targetPct × V_daily))
//
// Simple, dimensionally correct, and practical.
func OptimalSlicesVolume(quantity float64, avgDailyVolume float64, targetPct float64) int {
	if quantity <= 0 || avgDailyVolume <= 0 || targetPct <= 0 {
		return 1
	}
	sliceSize := targetPct * avgDailyVolume
	if sliceSize <= 0 {
		return 1
	}
	n := math.Ceil(quantity / sliceSize)
	if n < 1 {
		return 1
	}
	if n > 100 {
		return 100
	}
	return int(n)
}

// EstimateImpact returns impact estimate for a given quantity using calibrated params.
// refPrice is a reference price (e.g. current best price) to convert % impact to ISK.
func EstimateImpact(params ImpactParams, quantity float64, refPrice float64) ImpactEstimate {
	out := ImpactEstimate{Params: params}
	if quantity <= 0 {
		return out
	}

	out.LinearImpactPct = ImpactLinearPct(params.Amihud, quantity)
	out.SqrtImpactPct = ImpactSqrtPct(params.Sigma, quantity, params.AvgDailyVolume)

	// Choose recommendation: sqrt law for large orders (>1% of daily volume),
	// linear for small orders.
	if params.AvgDailyVolume > 0 && quantity > 0.01*params.AvgDailyVolume {
		out.RecommendedImpactPct = out.SqrtImpactPct
	} else {
		out.RecommendedImpactPct = out.LinearImpactPct
	}

	// Convert to ISK if reference price is available
	if refPrice > 0 {
		out.RecommendedImpactISK = refPrice * out.RecommendedImpactPct / 100
	}

	out.OptimalSlices = OptimalSlicesVolume(quantity, params.AvgDailyVolume, DefaultTWAPTargetPct)
	if out.OptimalSlices < 1 {
		out.OptimalSlices = 1
	}

	return out
}
