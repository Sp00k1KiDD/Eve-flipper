package corp

import (
	"math"
	"sort"
	"strings"
	"time"
)

// BuildDashboard aggregates raw data from a CorpDataProvider into a CorpDashboard.
func BuildDashboard(provider CorpDataProvider) (*CorpDashboard, error) {
	info := provider.GetInfo()
	isDemo := provider.IsDemo()

	wallets, err := provider.GetWallets()
	if err != nil {
		return nil, err
	}

	totalBalance := 0.0
	for _, w := range wallets {
		totalBalance += w.Balance
	}

	// Fetch journal for master wallet (division 1) for financial overview
	journal, _ := provider.GetJournal(1, 90)
	members, _ := provider.GetMembers()
	industryJobs, _ := provider.GetIndustryJobs()
	miningLedger, _ := provider.GetMiningLedger()
	orders, _ := provider.GetOrders()

	now := time.Now().UTC()
	day7ago := now.AddDate(0, 0, -7).Format("2006-01-02")
	day30ago := now.AddDate(0, 0, -30).Format("2006-01-02")

	// ---- Revenue / Expenses ----
	var rev7, exp7, rev30, exp30 float64
	for _, e := range journal {
		dateOnly := e.Date[:10]
		if dateOnly >= day30ago {
			if e.Amount > 0 {
				rev30 += e.Amount
			} else {
				exp30 += e.Amount
			}
		}
		if dateOnly >= day7ago {
			if e.Amount > 0 {
				rev7 += e.Amount
			} else {
				exp7 += e.Amount
			}
		}
	}

	// ---- Income by source ----
	incomeBySource := computeIncomeBySource(journal, day30ago)

	// ---- Daily P&L ----
	dailyPnL := computeDailyPnL(journal, 90, now)

	// ---- Top Contributors ----
	topContributors := computeTopContributors(journal, members, day30ago)

	// ---- Member Summary ----
	memberSummary := computeMemberSummary(members, now)

	// ---- Industry Summary ----
	industrySummary := computeIndustrySummary(industryJobs, now)

	// ---- Mining Summary ----
	miningSummary := computeMiningSummary(miningLedger)

	// ---- Market Summary ----
	marketSummary := computeMarketSummary(orders)

	return &CorpDashboard{
		Info:            info,
		IsDemo:          isDemo,
		Wallets:         wallets,
		TotalBalance:    totalBalance,
		Revenue30d:      rev30,
		Expenses30d:     exp30,
		NetIncome30d:    rev30 + exp30,
		Revenue7d:       rev7,
		Expenses7d:      exp7,
		NetIncome7d:     rev7 + exp7,
		IncomeBySource:  incomeBySource,
		DailyPnL:        dailyPnL,
		TopContributors: topContributors,
		MemberSummary:   memberSummary,
		IndustrySummary: industrySummary,
		MiningSummary:   miningSummary,
		MarketSummary:   marketSummary,
	}, nil
}

// ============================================================
// Income breakdown by source
// ============================================================

// refTypeCategory maps ESI ref_types to dashboard categories.
var refTypeCategory = map[string]string{
	"bounty_prizes":                   "bounties",
	"agent_mission_reward":            "bounties",
	"market_transaction":              "market",
	"market_escrow":                   "market",
	"brokers_fee":                     "market",
	"transaction_tax":                 "taxes",
	"planetary_interaction":           "pi",
	"industry_job_tax":                "industry",
	"reprocessing_tax":                "industry",
	"insurance":                       "srp",
	"moon_mining_extraction_tax":      "mining",
	"contract_price":                  "market",
	"player_donation":                 "other",
	"corporation_account_withdrawal":  "other",
	"office_rental_fee":               "taxes",
	"jump_clone_activation_fee":       "taxes",
}

var categoryLabels = map[string]string{
	"bounties": "Bounties & Ratting",
	"market":   "Market Operations",
	"mining":   "Moon Mining",
	"pi":       "Planetary Interaction",
	"industry": "Industry",
	"taxes":    "Taxes & Fees",
	"srp":      "SRP / Insurance",
	"other":    "Other",
}

func computeIncomeBySource(journal []CorpJournalEntry, since string) []IncomeSource {
	totals := make(map[string]float64)
	totalIncome := 0.0

	for _, e := range journal {
		if e.Date[:10] < since {
			continue
		}
		cat := refTypeCategory[e.RefType]
		if cat == "" {
			cat = "other"
		}
		totals[cat] += e.Amount
		if e.Amount > 0 {
			totalIncome += e.Amount
		}
	}

	var sources []IncomeSource
	for cat, amount := range totals {
		pct := 0.0
		if totalIncome > 0 {
			pct = math.Abs(amount) / totalIncome * 100
		}
		label := categoryLabels[cat]
		if label == "" {
			label = cat
		}
		sources = append(sources, IncomeSource{
			Category: cat,
			Label:    label,
			Amount:   amount,
			Percent:  math.Round(pct*10) / 10,
		})
	}

	// Sort by absolute value descending
	sort.Slice(sources, func(i, j int) bool {
		return math.Abs(sources[i].Amount) > math.Abs(sources[j].Amount)
	})

	return sources
}

// ============================================================
// Daily P&L
// ============================================================

func computeDailyPnL(journal []CorpJournalEntry, days int, now time.Time) []DailyPnLEntry {
	dailyMap := make(map[string]*DailyPnLEntry)

	// Pre-populate all days
	for d := days - 1; d >= 0; d-- {
		dateStr := now.AddDate(0, 0, -d).Format("2006-01-02")
		dailyMap[dateStr] = &DailyPnLEntry{Date: dateStr}
	}

	for _, e := range journal {
		dateOnly := e.Date[:10]
		entry, ok := dailyMap[dateOnly]
		if !ok {
			continue
		}
		if e.Amount > 0 {
			entry.Revenue += e.Amount
		} else {
			entry.Expenses += e.Amount
		}
		entry.NetIncome = entry.Revenue + entry.Expenses
		entry.Transactions++
	}

	// Convert to sorted slice and compute cumulative
	result := make([]DailyPnLEntry, 0, days)
	for d := days - 1; d >= 0; d-- {
		dateStr := now.AddDate(0, 0, -d).Format("2006-01-02")
		if entry, ok := dailyMap[dateStr]; ok {
			result = append(result, *entry)
		}
	}

	cumul := 0.0
	for i := range result {
		cumul += result[i].NetIncome
		result[i].Cumulative = cumul
	}

	return result
}

// ============================================================
// Top Contributors
// ============================================================

func computeTopContributors(journal []CorpJournalEntry, members []CorpMember, since string) []MemberContribution {
	// Sum positive amounts by first_party_id, track dominant ref_type per contributor
	contrib := make(map[int64]float64)
	contribRefTypes := make(map[int64]map[string]float64) // charID -> refType -> total ISK
	for _, e := range journal {
		if e.Date[:10] < since || e.Amount <= 0 {
			continue
		}
		contrib[e.FirstPartyID] += e.Amount
		if contribRefTypes[e.FirstPartyID] == nil {
			contribRefTypes[e.FirstPartyID] = make(map[string]float64)
		}
		contribRefTypes[e.FirstPartyID][e.RefType] += e.Amount
	}

	// Build name map from members + journal party names as fallback
	nameMap := make(map[int64]string)
	onlineMap := make(map[int64]bool)
	now := time.Now().UTC()
	for _, m := range members {
		nameMap[m.CharacterID] = m.Name
		// Consider "online" if last login within 15 minutes
		if m.LastLogin != "" {
			if t, err := time.Parse(time.RFC3339, m.LastLogin); err == nil {
				onlineMap[m.CharacterID] = now.Sub(t) < 15*time.Minute
			}
		}
	}
	// Fallback: use journal FirstPartyName for names not in member list
	for _, e := range journal {
		if _, ok := nameMap[e.FirstPartyID]; !ok && e.FirstPartyName != "" {
			nameMap[e.FirstPartyID] = e.FirstPartyName
		}
	}

	var result []MemberContribution
	for charID, total := range contrib {
		name := nameMap[charID]
		if name == "" {
			name = "Unknown"
		}

		// Determine category from dominant ref_type
		category := categorizeMember(contribRefTypes[charID])

		result = append(result, MemberContribution{
			CharacterID: charID,
			Name:        name,
			TotalISK:    total,
			Category:    category,
			IsOnline:    onlineMap[charID],
		})
	}

	sort.Slice(result, func(i, j int) bool {
		return result[i].TotalISK > result[j].TotalISK
	})

	// Keep top 15
	if len(result) > 15 {
		result = result[:15]
	}

	return result
}

// categorizeMember determines a member's primary economic role based on their
// dominant journal ref_type by ISK volume.
func categorizeMember(refTypes map[string]float64) string {
	if len(refTypes) == 0 {
		return "other"
	}

	categoryScores := make(map[string]float64)
	for refType, amount := range refTypes {
		cat := refTypeCategory[refType]
		if cat == "" {
			cat = "other"
		}
		switch cat {
		case "bounties":
			categoryScores["ratter"] += amount
		case "mining":
			categoryScores["miner"] += amount
		case "market":
			categoryScores["trader"] += amount
		case "industry":
			categoryScores["industrialist"] += amount
		default:
			categoryScores["other"] += amount
		}
	}

	// Pick the category with the highest ISK
	best := "other"
	bestAmount := 0.0
	for cat, amount := range categoryScores {
		if amount > bestAmount {
			best = cat
			bestAmount = amount
		}
	}
	return best
}

// ============================================================
// Member Summary
// ============================================================

func computeMemberSummary(members []CorpMember, now time.Time) MemberSummary {
	s := MemberSummary{TotalMembers: len(members)}

	day7 := now.AddDate(0, 0, -7)
	day30 := now.AddDate(0, 0, -30)

	for _, m := range members {
		if m.LastLogin == "" {
			s.Inactive30d++
			s.Other++
			continue
		}

		lastLogin, err := time.Parse(time.RFC3339, m.LastLogin)
		if err != nil {
			s.Inactive30d++
			s.Other++
			continue
		}

		if lastLogin.After(day7) {
			s.ActiveLast7d++
		}
		if lastLogin.After(day30) {
			s.ActiveLast30d++
		} else {
			s.Inactive30d++
		}

		// Categorize by ship type (rough heuristic)
		shipName := strings.ToLower(m.ShipName)
		switch {
		case containsAny(shipName, "hulk", "covetor", "procurer", "venture", "retriever", "skiff", "orca"):
			s.Miners++
		case containsAny(shipName, "ishtar", "vexor", "myrmidon", "dominix", "rattlesnake", "gila", "tengu"):
			s.Ratters++
		case containsAny(shipName, "iteron", "badger", "tayra", "epithal", "noctis", "rorqual"):
			s.Industrialists++
		case containsAny(shipName, "capsule", "impairor", "ibis", "velator", "reaper"):
			s.Traders++ // capsule/noob ship = probably a trader/alt
		case containsAny(shipName, "sabre", "muninn", "scimitar", "rifter", "hurricane", "drake", "cerberus"):
			s.PvPers++
		default:
			s.Other++
		}
	}

	return s
}

func containsAny(s string, substrs ...string) bool {
	for _, sub := range substrs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}

// ============================================================
// Industry Summary
// ============================================================

func computeIndustrySummary(jobs []CorpIndustryJob, now time.Time) IndustrySummary {
	s := IndustrySummary{}
	day30 := now.AddDate(0, 0, -30).Format(time.RFC3339)

	productRuns := make(map[int32]*ProductEntry)

	for _, j := range jobs {
		if j.Status == "active" {
			s.ActiveJobs++
		}
		if j.EndDate >= day30 && j.Status == "delivered" {
			s.CompletedJobs30d++
		}

		if j.Activity == "manufacturing" && j.Status == "delivered" {
			if pe, ok := productRuns[j.ProductTypeID]; ok {
				pe.Runs += j.Runs
				pe.Jobs++
			} else {
				productRuns[j.ProductTypeID] = &ProductEntry{
					TypeID:   j.ProductTypeID,
					TypeName: j.ProductName,
					Runs:     j.Runs,
					Jobs:     1,
				}
			}
		}
	}

	for _, pe := range productRuns {
		s.TopProducts = append(s.TopProducts, *pe)
	}
	sort.Slice(s.TopProducts, func(i, j int) bool {
		return s.TopProducts[i].Runs > s.TopProducts[j].Runs
	})
	if len(s.TopProducts) > 10 {
		s.TopProducts = s.TopProducts[:10]
	}

	return s
}

// ============================================================
// Mining Summary
// ============================================================

func computeMiningSummary(entries []CorpMiningEntry) MiningSummary {
	s := MiningSummary{}

	minerSet := make(map[int64]bool)
	oreMap := make(map[int32]*OreEntry)

	for _, e := range entries {
		s.TotalVolume30d += e.Quantity
		minerSet[e.CharacterID] = true

		if oe, ok := oreMap[e.TypeID]; ok {
			oe.Quantity += e.Quantity
		} else {
			oreMap[e.TypeID] = &OreEntry{
				TypeID:   e.TypeID,
				TypeName: e.TypeName,
				Quantity: e.Quantity,
			}
		}
	}

	s.ActiveMiners = len(minerSet)

	for _, oe := range oreMap {
		s.TopOres = append(s.TopOres, *oe)
	}
	sort.Slice(s.TopOres, func(i, j int) bool {
		return s.TopOres[i].Quantity > s.TopOres[j].Quantity
	})
	if len(s.TopOres) > 10 {
		s.TopOres = s.TopOres[:10]
	}

	// Rough ISK estimate: ~10 ISK per unit average (simplified)
	s.EstimatedISK = float64(s.TotalVolume30d) * 10

	return s
}

// ============================================================
// Market Summary
// ============================================================

func computeMarketSummary(orders []CorpMarketOrder) MarketSummary {
	s := MarketSummary{}
	traderSet := make(map[int64]bool)

	for _, o := range orders {
		traderSet[o.CharacterID] = true
		if o.IsBuyOrder {
			s.ActiveBuyOrders++
			s.TotalBuyValue += o.Price * float64(o.VolumeRemain)
		} else {
			s.ActiveSellOrders++
			s.TotalSellValue += o.Price * float64(o.VolumeRemain)
		}
	}
	s.UniqueTraders = len(traderSet)

	return s
}
