package engine

import (
	"math"
	"sort"

	"eve-flipper/internal/esi"
)

// ImpactParams holds calibrated market impact parameters from history.
type ImpactParams struct {
	// Lambda (Kyle): linear impact ΔP = λ × Q. Units: ISK per unit volume.
	Lambda float64 `json:"lambda"`
	// Eta: square-root impact ΔP = η × √Q. Units: ISK × unit^(−0.5).
	Eta float64 `json:"eta"`
	// SigmaSq: variance of daily (log or simple) returns. Used in n* = √(σ² T / (2 λ κ)).
	SigmaSq float64 `json:"sigma_sq"`
	// Sigma: annualized or per-period volatility (sqrt of variance in same units as T).
	Sigma float64 `json:"sigma"`
	// DaysUsed is the number of history days used for calibration.
	DaysUsed int `json:"days_used"`
	// Valid is true if calibration succeeded (enough data).
	Valid bool `json:"valid"`
}

// ImpactEstimate is the result of applying the impact model for a given quantity.
type ImpactEstimate struct {
	// LinearImpact: ΔP = λ × Q (ISK).
	LinearImpact float64 `json:"linear_impact"`
	// SqrtImpact: ΔP = η × √Q (ISK). Often more realistic for larger orders.
	SqrtImpact float64 `json:"sqrt_impact"`
	// Recommended: we use sqrt impact as default recommendation.
	RecommendedImpact float64 `json:"recommended_impact"`
	// OptimalSlicesTWAP: n* = √(σ² T / (2 λ κ)). Suggested number of slices for TWAP.
	OptimalSlicesTWAP int `json:"optimal_slices_twap"`
	// Params used for this estimate.
	Params ImpactParams `json:"params"`
}

const (
	// DefaultImpactDays is the number of history days used for λ/η calibration.
	DefaultImpactDays = 30
	// DefaultTWAPHorizonDays is T in the n* formula (time horizon for execution).
	DefaultTWAPHorizonDays = 1
	// DefaultKappaRatio: κ = kappaRatio × λ (temporary impact cost in Almgren-Chriss style).
	DefaultKappaRatio = 0.5
)

// CalibrateImpact fits Lambda (linear) and Eta (sqrt) from market history.
// Uses daily (High-Low) as proxy for price impact and Volume as Q.
// Lambda: (High-Low)/Volume per day, then median over days.
// Eta: (High-Low)/sqrt(Volume) per day, then median.
// SigmaSq: variance of daily log returns (so n* formula uses consistent units).
func CalibrateImpact(history []esi.HistoryEntry, days int) ImpactParams {
	entries := filterLastNDays(history, days)
	if len(entries) < 5 {
		return ImpactParams{}
	}

	var lambdas, etas []float64
	var logReturns []float64
	var prevAvg float64

	for i, h := range entries {
		if h.Average <= 0 {
			continue
		}
		if h.Volume > 0 {
			dayRange := h.Highest - h.Lowest
			if dayRange < 0 {
				dayRange = 0
			}
			lambdas = append(lambdas, dayRange/float64(h.Volume))
			etas = append(etas, dayRange/math.Sqrt(float64(h.Volume)))
		}
		if i > 0 && prevAvg > 0 {
			logRet := math.Log(h.Average / prevAvg)
			logReturns = append(logReturns, logRet)
		}
		prevAvg = h.Average
	}

	out := ImpactParams{DaysUsed: len(entries)}
	if len(lambdas) < 3 {
		return out
	}

	out.Lambda = median(lambdas)
	out.Eta = median(etas)
	if len(logReturns) >= 2 {
		out.SigmaSq = variance(logReturns)
		out.Sigma = math.Sqrt(out.SigmaSq)
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
	return sq / float64(len(x))
}

// ImpactLinear returns price impact (ΔP) for quantity Q using linear model: ΔP = λ × Q.
func ImpactLinear(lambda float64, quantity float64) float64 {
	if quantity <= 0 {
		return 0
	}
	return lambda * quantity
}

// ImpactSqrt returns price impact (ΔP) for quantity Q using square-root model: ΔP = η × √Q.
func ImpactSqrt(eta float64, quantity float64) float64 {
	if quantity <= 0 {
		return 0
	}
	return eta * math.Sqrt(quantity)
}

// OptimalSlicesTWAP computes optimal number of slices for TWAP/VWAP:
//
//	n* = √(σ² T / (2 λ κ))
//
// With κ = kappaRatio × λ:  n* = √(σ² T / (2 λ² κappaRatio)).
// T is in days, σ² is variance of daily log-returns (so same time scale).
func OptimalSlicesTWAP(sigmaSq, lambda float64, horizonDays float64, kappaRatio float64) int {
	if sigmaSq <= 0 || lambda <= 0 || horizonDays <= 0 || kappaRatio <= 0 {
		return 1
	}
	kappa := kappaRatio * lambda
	denom := 2 * lambda * kappa
	if denom <= 0 {
		return 1
	}
	n := math.Sqrt(sigmaSq * horizonDays / denom)
	if n < 1 {
		return 1
	}
	if n > 100 {
		return 100
	}
	return int(math.Ceil(n))
}

// EstimateImpact returns impact estimate for a given quantity using calibrated params.
func EstimateImpact(params ImpactParams, quantity float64, horizonDays float64) ImpactEstimate {
	out := ImpactEstimate{Params: params}
	if quantity <= 0 {
		return out
	}
	out.LinearImpact = ImpactLinear(params.Lambda, quantity)
	out.SqrtImpact = ImpactSqrt(params.Eta, quantity)
	out.RecommendedImpact = out.SqrtImpact
	out.OptimalSlicesTWAP = OptimalSlicesTWAP(params.SigmaSq, params.Lambda, horizonDays, DefaultKappaRatio)
	if out.OptimalSlicesTWAP < 1 {
		out.OptimalSlicesTWAP = 1
	}
	return out
}
