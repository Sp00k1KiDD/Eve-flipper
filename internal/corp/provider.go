package corp

// CorpDataProvider is the abstraction layer for corporation data.
// Two implementations exist:
//   - DemoCorpProvider: generates realistic synthetic data for testing/demo
//   - ESICorpProvider:  fetches real data from EVE ESI API (requires Director role)
type CorpDataProvider interface {
	// GetInfo returns basic corporation identity.
	GetInfo() CorpInfo

	// GetWallets returns all 7 wallet divisions with balances.
	GetWallets() ([]CorpWalletDivision, error)

	// GetJournal returns wallet journal entries for a division.
	// division: 1-7, days: how many days of history (0 = all available).
	GetJournal(division int, days int) ([]CorpJournalEntry, error)

	// GetTransactions returns market transactions for a wallet division.
	GetTransactions(division int) ([]CorpTransaction, error)

	// GetMembers returns the corporation member list with tracking data.
	GetMembers() ([]CorpMember, error)

	// GetIndustryJobs returns active and recent industry jobs.
	GetIndustryJobs() ([]CorpIndustryJob, error)

	// GetMiningLedger returns mining activity from observers.
	GetMiningLedger() ([]CorpMiningEntry, error)

	// GetOrders returns active corporation market orders.
	GetOrders() ([]CorpMarketOrder, error)

	// IsDemo returns true if this provider serves synthetic demo data.
	IsDemo() bool
}
