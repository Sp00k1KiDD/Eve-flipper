package engine

import (
	"fmt"
	"log"
	"math"
	"sort"
	"strings"
	"sync"

	"eve-flipper/internal/esi"
)

const (
	// DefaultMinContractPrice filters out scam/bait contracts below this ISK threshold.
	DefaultMinContractPrice = 10_000_000 // 10M ISK
	// DefaultMaxContractMargin filters out scam contracts with unrealistically high margins (%).
	DefaultMaxContractMargin = 100 // margins >100% are almost always scams
	// DefaultMinPricedRatio is the minimum fraction of item types that must have a market price.
	DefaultMinPricedRatio = 0.8
	// MinSellOrderVolume is the minimum total sell volume to trust the price.
	MinSellOrderVolume = 5
	// MaxVWAPDeviation is the maximum % deviation from VWAP to consider contract valid.
	MaxVWAPDeviation = 30.0
	// MinDailyVolumeForContract filters out items with no recent trading activity.
	MinDailyVolumeForContract = 1
	// DefaultContractHoldDays is the default holding horizon for non-instant mode.
	DefaultContractHoldDays = 7
	// DefaultContractTargetConfidence is the default minimum full-liquidation probability (%).
	DefaultContractTargetConfidence = 80.0
	// ContractFillParticipation is a conservative share of daily market volume we expect to capture.
	ContractFillParticipation = 0.35
	// ContractConservativePriceHaircut is an additional conservative markdown on expected proceeds.
	ContractConservativePriceHaircut = 0.03
	// ContractDailyCarryRate models opportunity/carry cost of locked capital per day.
	ContractDailyCarryRate = 0.001
)

// getContractFilters returns effective filter values, using defaults if params are 0.
func getContractFilters(params ScanParams) (minPrice, maxMargin, minPricedRatio float64) {
	minPrice = params.MinContractPrice
	if minPrice <= 0 {
		minPrice = DefaultMinContractPrice
	}
	maxMargin = params.MaxContractMargin
	if maxMargin <= 0 {
		maxMargin = DefaultMaxContractMargin
	}
	minPricedRatio = params.MinPricedRatio
	if minPricedRatio <= 0 {
		minPricedRatio = DefaultMinPricedRatio
	}
	return
}

func contractSellValueMultiplier(params ScanParams) float64 {
	// Instant liquidation sells immediately into existing buy orders:
	// no broker fee is paid, only sales tax.
	if params.ContractInstantLiquidation {
		m := 1.0 - params.SalesTaxPercent/100
		if m < 0 {
			return 0
		}
		return m
	}
	// Market-estimate mode assumes placing sell orders on market:
	// sales tax + broker fee on sell side.
	feePercent := params.SalesTaxPercent + params.BrokerFeePercent
	m := 1.0 - feePercent/100
	if m < 0 {
		return 0
	}
	return m
}

func contractHoldDays(params ScanParams) int {
	if params.ContractHoldDays <= 0 {
		return DefaultContractHoldDays
	}
	if params.ContractHoldDays > 180 {
		return 180
	}
	return params.ContractHoldDays
}

func contractTargetConfidence(params ScanParams) float64 {
	if params.ContractTargetConfidence <= 0 {
		return DefaultContractTargetConfidence
	}
	if params.ContractTargetConfidence > 100 {
		return 100
	}
	return params.ContractTargetConfidence
}

func effectiveDailyVolume(pd *itemPriceData) float64 {
	if pd == nil {
		return 0
	}
	if pd.DailyVolume > 0 {
		return pd.DailyVolume
	}
	// Fallback proxy when history is unavailable: treat current book depth
	// as roughly two weeks of turnover.
	if pd.TotalSellVol > 0 {
		return float64(pd.TotalSellVol) / 14.0
	}
	return 0
}

func estimateFillDays(quantity int32, dailyVol float64) float64 {
	if quantity <= 0 {
		return 0
	}
	if dailyVol <= 0 {
		return math.Inf(1)
	}
	executablePerDay := dailyVol * ContractFillParticipation
	if executablePerDay <= 0 {
		return math.Inf(1)
	}
	return float64(quantity) / executablePerDay
}

func fillProbabilityWithinDays(fillDays, horizonDays float64) float64 {
	if horizonDays <= 0 {
		return 0
	}
	if fillDays <= 0 {
		return 1
	}
	if math.IsInf(fillDays, 1) {
		return 0
	}
	p := 1 - math.Exp(-horizonDays/fillDays)
	if p < 0 {
		return 0
	}
	if p > 1 {
		return 1
	}
	return p
}

// itemPriceData holds market data for an item type.
type itemPriceData struct {
	MinSellPrice float64 // Cheapest sell order price
	TotalSellVol int32   // Total volume of sell orders
	SellOrderCnt int     // Number of sell orders
	VWAP         float64 // Volume-weighted average price from history (0 if no history)
	DailyVolume  float64 // Average daily trading volume
	HasHistory   bool    // Whether we have reliable history data
}

// ScanContracts finds profitable public contracts by comparing contract price to market value.
func (s *Scanner) ScanContracts(params ScanParams, progress func(string)) ([]ContractResult, error) {
	// Get effective filter values
	minContractPrice, maxContractMargin, minPricedRatio := getContractFilters(params)

	progress("Finding systems within radius...")
	var buySystems map[int32]int
	if params.MinRouteSecurity > 0 {
		buySystems = s.SDE.Universe.SystemsWithinRadiusMinSecurity(params.CurrentSystemID, params.BuyRadius, params.MinRouteSecurity)
	} else {
		buySystems = s.SDE.Universe.SystemsWithinRadius(params.CurrentSystemID, params.BuyRadius)
	}
	buyRegions := s.SDE.Universe.RegionsInSet(buySystems)
	contractInstant := params.ContractInstantLiquidation

	var sellSystems map[int32]int
	var sellRegions map[int32]bool
	if contractInstant {
		if params.MinRouteSecurity > 0 {
			sellSystems = s.SDE.Universe.SystemsWithinRadiusMinSecurity(params.CurrentSystemID, params.SellRadius, params.MinRouteSecurity)
		} else {
			sellSystems = s.SDE.Universe.SystemsWithinRadius(params.CurrentSystemID, params.SellRadius)
		}
		sellRegions = s.SDE.Universe.RegionsInSet(sellSystems)
	}

	log.Printf("[DEBUG] ScanContracts: buySystems=%d, buyRegions=%d, minPrice=%.0f, maxMargin=%.1f",
		len(buySystems), len(buyRegions), minContractPrice, maxContractMargin)

	// Fetch market orders and contracts in parallel
	var sellOrders []esi.MarketOrder
	var buyOrdersForLiquidation []esi.MarketOrder
	var allContracts []esi.PublicContract
	var contractsMu sync.Mutex
	var wg sync.WaitGroup

	progress(fmt.Sprintf("Fetching market orders + contracts from %d regions...", len(buyRegions)))

	wg.Add(2)
	go func() {
		defer wg.Done()
		sellOrders = s.fetchOrders(buyRegions, "sell", buySystems)
	}()
	if contractInstant {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buyOrdersForLiquidation = s.fetchOrders(sellRegions, "buy", sellSystems)
		}()
	}
	go func() {
		defer wg.Done()
		// Fetch contracts from ALL regions in PARALLEL (with caching)
		var contractsWg sync.WaitGroup
		for rid := range buyRegions {
			contractsWg.Add(1)
			go func(regionID int32) {
				defer contractsWg.Done()
				contracts, err := s.ESI.FetchRegionContractsCached(s.ContractsCache, regionID)
				if err != nil {
					log.Printf("[DEBUG] failed to fetch contracts for region %d: %v", regionID, err)
					return
				}
				contractsMu.Lock()
				allContracts = append(allContracts, contracts...)
				contractsMu.Unlock()
			}(rid)
		}
		contractsWg.Wait()
	}()
	wg.Wait()

	log.Printf("[DEBUG] ScanContracts: %d sell orders, %d contracts total", len(sellOrders), len(allContracts))
	if contractInstant {
		log.Printf("[DEBUG] ScanContracts: instant liquidation enabled, %d buy orders in sell radius", len(buyOrdersForLiquidation))
	}

	// Build location -> system map from market orders (covers player structures
	// that are not present in SDE.Stations).
	marketLocationSystems := make(map[int64]int32, len(sellOrders))
	for _, o := range sellOrders {
		if o.LocationID == 0 || o.SystemID == 0 {
			continue
		}
		if _, exists := marketLocationSystems[o.LocationID]; !exists {
			marketLocationSystems[o.LocationID] = o.SystemID
		}
	}
	for _, o := range buyOrdersForLiquidation {
		if o.LocationID == 0 || o.SystemID == 0 {
			continue
		}
		if _, exists := marketLocationSystems[o.LocationID]; !exists {
			marketLocationSystems[o.LocationID] = o.SystemID
		}
	}

	// Instant liquidation pricing input: buy-book depth by type (sell radius).
	buyOrdersByType := make(map[int32][]esi.MarketOrder)
	if contractInstant {
		for _, o := range buyOrdersForLiquidation {
			buyOrdersByType[o.TypeID] = append(buyOrdersByType[o.TypeID], o)
		}
	}

	// Build price data map: typeID -> itemPriceData
	// Track min price, total volume, and order count per type
	priceData := make(map[int32]*itemPriceData)
	for _, o := range sellOrders {
		pd, ok := priceData[o.TypeID]
		if !ok {
			pd = &itemPriceData{MinSellPrice: math.MaxFloat64}
			priceData[o.TypeID] = pd
		}
		if o.Price < pd.MinSellPrice {
			pd.MinSellPrice = o.Price
		}
		pd.TotalSellVol += o.VolumeRemain
		pd.SellOrderCnt++
	}

	// Clean up items with insufficient market data
	for typeID, pd := range priceData {
		if pd.MinSellPrice == math.MaxFloat64 {
			delete(priceData, typeID)
			continue
		}
		// Require minimum sell volume to trust the price
		if pd.TotalSellVol < MinSellOrderVolume {
			pd.MinSellPrice = pd.MinSellPrice * 1.5 // Penalize low-volume items
		}
	}

	// Filter contracts: only item_exchange, not expired, price > threshold, reachable location
	var candidates []esi.PublicContract
	for _, c := range allContracts {
		if c.Type != "item_exchange" {
			continue
		}
		if c.IsExpired() {
			continue
		}
		if c.Price < minContractPrice {
			continue // skip scam/bait contracts with very low prices
		}
		// Pre-filter: skip contracts in unknown or unreachable locations.
		// If we can't map location -> system, we can't verify accessibility.
		sysID := s.locationToSystem(c.StartLocationID, marketLocationSystems)
		if sysID == 0 {
			continue
		}
		if _, ok := buySystems[sysID]; !ok {
			continue // contract station is outside buy radius
		}
		candidates = append(candidates, c)
	}

	log.Printf("[DEBUG] ScanContracts: %d item_exchange candidates after filtering (location + price)", len(candidates))
	progress(fmt.Sprintf("Evaluating %d contracts...", len(candidates)))

	if len(candidates) == 0 {
		return nil, nil
	}

	// Fetch items for all candidates
	contractIDs := make([]int32, len(candidates))
	for i, c := range candidates {
		contractIDs[i] = c.ContractID
	}

	contractItems := s.ESI.FetchContractItemsBatch(contractIDs, s.ContractItemsCache, func(done, total int) {
		progress(fmt.Sprintf("Fetching contract items %d/%d...", done, total))
	})

	log.Printf("[DEBUG] ScanContracts: fetched items for %d contracts", len(contractItems))

	// Collect unique type IDs that need history lookup (estimate mode only).
	if !contractInstant {
		typeIDsNeedHistory := make(map[int32]bool)
		for _, items := range contractItems {
			for _, item := range items {
				if item.IsIncluded && !item.IsBlueprintCopy {
					if _, ok := priceData[item.TypeID]; ok {
						typeIDsNeedHistory[item.TypeID] = true
					}
				}
			}
		}

		// Fetch market history for pricing validation — prefer trade hub region for VWAP
		primaryRegion := bestHubRegion(buyRegions)

		if s.History != nil && len(typeIDsNeedHistory) > 0 {
			progress(fmt.Sprintf("Fetching market history for %d item types...", len(typeIDsNeedHistory)))
			s.fetchContractItemsHistory(typeIDsNeedHistory, priceData, primaryRegion)
		}

		log.Printf("[DEBUG] ScanContracts: enriched %d types with history", len(typeIDsNeedHistory))
	}

	// Calculate profit for each contract.
	sellValueMult := contractSellValueMultiplier(params)
	holdDays := contractHoldDays(params)
	targetConfidence := contractTargetConfidence(params)

	var results []ContractResult

	for _, contract := range candidates {
		items, ok := contractItems[contract.ContractID]
		if !ok || len(items) == 0 {
			continue
		}

		var marketValue float64
		var itemCount int32
		var pricedCount int        // how many item types we could price
		var totalTypes int         // total included item types (non-BPC)
		var topItems []string      // for generating title
		var lowVolumeItems int     // items with suspicious low trading volume
		var highDeviationItems int // items where sell price deviates significantly from VWAP
		fullLiquidationProb := 1.0
		maxFillDays := 0.0
		expectedGrossByFill := 0.0

		hasBPO := false
		for _, item := range items {
			if !item.IsIncluded {
				continue // items the buyer must provide
			}
			if item.IsBlueprintCopy {
				continue // BPCs have no reliable market price
			}

			// Detect BPOs/BPCs by checking SDE category or name
			if typeName, ok := s.SDE.Types[item.TypeID]; ok {
				nameLower := strings.ToLower(typeName.Name)
				if strings.Contains(nameLower, "blueprint") {
					hasBPO = true
					continue
				}
			}
			totalTypes++

			if contractInstant {
				book := buyOrdersByType[item.TypeID]
				if len(book) == 0 {
					continue
				}
				plan := ComputeExecutionPlan(book, item.Quantity, false)
				if !plan.CanFill || plan.ExpectedPrice <= 0 {
					continue
				}

				pricedCount++
				marketValue += plan.ExpectedPrice * float64(item.Quantity)
				itemCount += item.Quantity

				if typeName, ok := s.SDE.Types[item.TypeID]; ok {
					if item.Quantity > 1 {
						topItems = append(topItems, fmt.Sprintf("%dx %s", item.Quantity, typeName.Name))
					} else {
						topItems = append(topItems, typeName.Name)
					}
				}
				continue
			}

				pd, ok := priceData[item.TypeID]
				if !ok || pd.MinSellPrice == 0 || pd.MinSellPrice == math.MaxFloat64 {
					continue // can't price this item
			}

			// Determine the best price to use: prefer VWAP if available and reliable
			var usePrice float64
			if pd.HasHistory && pd.VWAP > 0 {
				// Check if min sell deviates too much from VWAP (potential bait order)
				if pd.MinSellPrice < pd.VWAP*0.5 {
					// Sell price is <50% of VWAP — likely a bait order.
					// Use conservative estimate: min(70% VWAP, 2x MinSell) to avoid inflating value.
					usePrice = math.Min(pd.VWAP*0.7, pd.MinSellPrice*2)
					highDeviationItems++
				} else {
					// Normal case: use the lower of VWAP and market sell price
					usePrice = math.Min(pd.VWAP, pd.MinSellPrice)
				}
			} else {
				// No history — if RequireHistory is set, skip this item entirely
				if params.RequireHistory {
					continue
				}
				// No history — use min sell but be conservative
				usePrice = pd.MinSellPrice
			}

			// Track items with low daily volume (unreliable pricing)
			if pd.DailyVolume < MinDailyVolumeForContract {
				lowVolumeItems++
			}

				pricedCount++
				marketValue += usePrice * float64(item.Quantity)
				itemCount += item.Quantity

				dailyVol := effectiveDailyVolume(pd)
				fillDays := estimateFillDays(item.Quantity, dailyVol)
				itemFillProb := fillProbabilityWithinDays(fillDays, float64(holdDays))
				fullLiquidationProb *= itemFillProb
				if math.IsInf(fillDays, 1) {
					if maxFillDays < float64(holdDays)*10 {
						maxFillDays = float64(holdDays) * 10
					}
				} else if fillDays > maxFillDays {
					maxFillDays = fillDays
				}
				expectedGrossByFill += usePrice * float64(item.Quantity) * itemFillProb

				// Build item name for title generation
				if typeName, ok := s.SDE.Types[item.TypeID]; ok {
				if item.Quantity > 1 {
					topItems = append(topItems, fmt.Sprintf("%dx %s", item.Quantity, typeName.Name))
				} else {
					topItems = append(topItems, typeName.Name)
				}
			}
		}

		// Skip contracts that are purely BPOs — unreliable market pricing
		if hasBPO && totalTypes == 0 {
			continue
		}

		// Skip if we couldn't price most items
		if totalTypes == 0 || pricedCount == 0 {
			continue
		}
		if float64(pricedCount)/float64(totalTypes) < minPricedRatio {
			continue
		}
		// In instant liquidation mode, require full immediate liquidation of all
		// included tradable items in the contract.
		if contractInstant && pricedCount < totalTypes {
			continue
		}

		// Skip if too many items have low volume (unreliable pricing)
		if pricedCount > 0 && float64(lowVolumeItems)/float64(pricedCount) > 0.5 {
			continue // >50% items have no recent trading — unreliable
		}

		// Skip if too many items have suspicious price deviations
		if pricedCount > 0 && float64(highDeviationItems)/float64(pricedCount) > 0.3 {
			continue // >30% items have bait-like pricing — suspicious
		}

		if marketValue <= 0 {
			continue
		}

		// Calculate profit
		effectiveValue := marketValue * sellValueMult
		profit := effectiveValue - contract.Price
		if profit <= 0 {
			continue
		}

		margin := profit / contract.Price * 100
		if margin > maxContractMargin {
			continue // margin too high — likely a scam or pricing error
		}

		expectedProfit := profit
		expectedMargin := margin
		sellConfidencePct := 100.0
		estLiqDays := 0.0
		conservativeValue := effectiveValue
		carryCost := 0.0

		if !contractInstant {
			sellConfidencePct = fullLiquidationProb * 100
			if sellConfidencePct < targetConfidence {
				continue
			}
			estLiqDays = maxFillDays
			conservativeGross := expectedGrossByFill * (1.0 - ContractConservativePriceHaircut)
			conservativeValue = conservativeGross * sellValueMult
			carryCost = contract.Price * ContractDailyCarryRate * float64(holdDays)
			expectedProfit = conservativeValue - contract.Price - carryCost
			if expectedProfit <= 0 {
				continue
			}
			expectedMargin = safeDiv(expectedProfit, contract.Price) * 100
		}

		if expectedMargin < params.MinMargin {
			continue
		}

		// Generate title from items if contract title is empty
		title := strings.TrimSpace(contract.Title)
		if title == "" {
			if len(topItems) == 1 {
				title = topItems[0]
			} else if len(topItems) <= 3 {
				title = strings.Join(topItems, ", ")
			} else {
				title = fmt.Sprintf("%s + %d more", strings.Join(topItems[:2], ", "), len(topItems)-2)
			}
		}

		stationName := s.ESI.StationName(contract.StartLocationID)

		// Resolve system and region for the contract location
		sysID := s.locationToSystem(contract.StartLocationID, marketLocationSystems)
		sysName := ""
		regionName := ""
		if sysID != 0 {
			sysName = s.systemName(sysID)
			if sys, ok := s.SDE.Systems[sysID]; ok {
				regionName = s.regionName(sys.RegionID)
			}
		}
		if strings.HasPrefix(stationName, "Location ") || strings.HasPrefix(stationName, "Structure ") {
			if eveName := s.ESI.EVERefStructureName(contract.StartLocationID); eveName != "" {
				stationName = eveName
			} else if sysName != "" {
				stationName = fmt.Sprintf("Structure @ %s", sysName)
			}
		}

		// Calculate jumps from current system to contract station
		jumps := 0
		if sysID != 0 {
			if d, ok := buySystems[sysID]; ok {
				jumps = d
			} else {
				jumps = s.jumpsBetweenWithSecurity(params.CurrentSystemID, sysID, params.MinRouteSecurity)
			}
		}

		var profitPerJump float64
		if jumps > 0 {
			profitPerJump = profit / float64(jumps)
		}

		results = append(results, ContractResult{
			ContractID:    contract.ContractID,
			Title:         title,
			Price:         contract.Price,
			MarketValue:   marketValue,
			Profit:        sanitizeFloat(profit),
			MarginPercent: sanitizeFloat(margin),
			ExpectedProfit:        sanitizeFloat(expectedProfit),
			ExpectedMarginPercent: sanitizeFloat(expectedMargin),
			SellConfidence:        sanitizeFloat(sellConfidencePct),
			EstLiquidationDays:    sanitizeFloat(estLiqDays),
			ConservativeValue:     sanitizeFloat(conservativeValue),
			CarryCost:             sanitizeFloat(carryCost),
			Volume:        contract.Volume,
			StationName:   stationName,
			SystemName:    sysName,
			RegionName:    regionName,
			ItemCount:     itemCount,
			Jumps:         jumps,
			ProfitPerJump: sanitizeFloat(profitPerJump),
		})
	}

	log.Printf("[DEBUG] ScanContracts: %d profitable results", len(results))

	// Sort by profit descending, keep top 100
	sort.Slice(results, func(i, j int) bool {
		left := results[i].ExpectedProfit
		if left == 0 {
			left = results[i].Profit
		}
		right := results[j].ExpectedProfit
		if right == 0 {
			right = results[j].Profit
		}
		return left > right
	})
	// Cap to prevent server overload on contract results
	if len(results) > MaxUnlimitedResults {
		results = results[:MaxUnlimitedResults]
	}

	progress(fmt.Sprintf("Found %d profitable contracts", len(results)))
	return results, nil
}

// locationToSystem maps a station/structure ID to its solar system ID.
func (s *Scanner) locationToSystem(locationID int64, marketLocationSystems map[int64]int32) int32 {
	if station, ok := s.SDE.Stations[locationID]; ok {
		return station.SystemID
	}
	if marketLocationSystems != nil {
		if sysID, ok := marketLocationSystems[locationID]; ok {
			return sysID
		}
	}
	return 0
}

// fetchContractItemsHistory fetches market history for contract items and calculates VWAP.
func (s *Scanner) fetchContractItemsHistory(typeIDs map[int32]bool, priceData map[int32]*itemPriceData, regionID int32) {
	if s.History == nil || len(typeIDs) == 0 {
		return
	}

	// Use semaphore to limit concurrent requests (increased from 10 to 30)
	sem := make(chan struct{}, 30)
	var wg sync.WaitGroup

	for typeID := range typeIDs {
		pd, ok := priceData[typeID]
		if !ok {
			continue
		}

		wg.Add(1)
		sem <- struct{}{}
		go func(tid int32, pdata *itemPriceData) {
			defer wg.Done()
			defer func() { <-sem }()

			// Try cache first
			entries, ok := s.History.GetMarketHistory(regionID, tid)
			if !ok {
				// Fetch from ESI
				var err error
				entries, err = s.ESI.FetchMarketHistory(regionID, tid)
				if err != nil {
					return
				}
				s.History.SetMarketHistory(regionID, tid, entries)
			}

			if len(entries) == 0 {
				return
			}

			// Calculate VWAP (30 days)
			pdata.VWAP = CalcVWAP(entries, 30)
			pdata.DailyVolume = avgDailyVolume(entries, 7)
			pdata.HasHistory = true
		}(typeID, pd)
	}

	wg.Wait()
}

// bestHubRegion picks the highest-priority trade hub region from the set,
// falling back to the lowest numeric ID for determinism.
func bestHubRegion(regions map[int32]bool) int32 {
	best := int32(0)
	bestPri := int(^uint(0) >> 1) // max int
	for rid := range regions {
		if pri, ok := hubRegionPriority[rid]; ok && pri < bestPri {
			best = rid
			bestPri = pri
		} else if best == 0 || (bestPri == int(^uint(0)>>1) && rid < best) {
			best = rid
		}
	}
	return best
}
