import { useCallback, useEffect, useRef, useState } from "react";
import { createChart, ColorType, LineStyle, CrosshairMode, LineSeries, HistogramSeries } from "lightweight-charts";
import type { IChartApi, ISeriesApi, LineData, Time } from "lightweight-charts";
import { getPLEXDashboard, type PLEXDashboardParams } from "../lib/api";
import { formatISK } from "../lib/format";
import { useI18n } from "../lib/i18n";
import { useTheme } from "../lib/useTheme";
import type { PLEXDashboard, ArbitragePath, PLEXGlobalPrice, PricePoint, PLEXIndicators, ChartOverlays, ArbHistoryData, MarketDepthInfo } from "../lib/types";

/** Format seconds as M:SS */
function formatCountdown(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function PlexTab() {
  const { t } = useI18n();
  const { themeKey } = useTheme();
  const [dashboard, setDashboard] = useState<PLEXDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [salesTax, setSalesTax] = useState(3.6);
  const [brokerFee, setBrokerFee] = useState(1.0);
  const [nesExtractor, setNesExtractor] = useState(293);
  const [nesMPTC, setNesMPTC] = useState(485);
  const [nesOmega, setNesOmega] = useState(500);
  const [showNES, setShowNES] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [autoInterval, setAutoInterval] = useState(5); // minutes
  const [countdown, setCountdown] = useState(0); // seconds remaining

  const abortRef = useRef<AbortController | null>(null);
  const autoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    // Abort any in-flight request
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError("");
    try {
      const params: PLEXDashboardParams = {
        salesTax, brokerFee,
        nesExtractor, nesMPTC, nesOmega,
      };
      const data = await getPLEXDashboard(params, controller.signal);
      setDashboard(data);
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setError(e instanceof Error ? e.message : "Failed to load PLEX data");
    } finally {
      setLoading(false);
    }
  }, [salesTax, brokerFee, nesExtractor, nesMPTC, nesOmega]);

  // Fetch on mount
  useEffect(() => {
    fetchData();
    return () => abortRef.current?.abort();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-refresh timer
  useEffect(() => {
    // Clear previous timers
    if (autoTimerRef.current) { clearInterval(autoTimerRef.current); autoTimerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    setCountdown(0);

    if (!autoRefresh) return;

    const intervalMs = autoInterval * 60 * 1000;
    setCountdown(autoInterval * 60);

    // Countdown ticker (every second)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => prev > 0 ? prev - 1 : 0);
    }, 1000);

    // Fetch timer
    autoTimerRef.current = setInterval(() => {
      fetchData();
      setCountdown(autoInterval * 60); // reset countdown after fetch
    }, intervalMs);

    return () => {
      if (autoTimerRef.current) clearInterval(autoTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [autoRefresh, autoInterval, fetchData]);

  const [selectedArb, setSelectedArb] = useState<ArbitragePath | null>(null);
  const [arbTab, setArbTab] = useState<"nes" | "spread">("nes");

  const signal = dashboard?.signal;
  const ind = dashboard?.indicators;

  return (
    <div className="flex flex-col gap-3 h-full overflow-y-auto pr-1 scrollbar-thin">
      {/* Top bar: controls */}
      <div className="flex items-center gap-3 flex-wrap shrink-0">
        <h2 className="text-sm font-semibold text-eve-accent uppercase tracking-wider">{t("plexTitle")}</h2>
        <div className="flex items-center gap-2 text-xs">
          <label className="text-eve-dim">{t("paramsTax")}</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={salesTax}
            onChange={(e) => setSalesTax(parseFloat(e.target.value) || 0)}
            className="w-16 px-1.5 py-1 bg-eve-input border border-eve-border rounded-sm text-xs text-eve-text"
          />
          <label className="text-eve-dim">{t("paramsBrokerFee")}</label>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={brokerFee}
            onChange={(e) => setBrokerFee(parseFloat(e.target.value) || 0)}
            className="w-16 px-1.5 py-1 bg-eve-input border border-eve-border rounded-sm text-xs text-eve-text"
          />
        </div>
        <button
          onClick={() => setShowNES((v) => !v)}
          className={`px-2 py-1 rounded-sm text-[10px] font-semibold uppercase tracking-wider border transition-all ${showNES ? "border-eve-accent/50 bg-eve-accent/10 text-eve-accent" : "border-eve-border bg-eve-panel text-eve-dim hover:text-eve-text"}`}
        >
          NES ▾
        </button>
        <button
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 rounded-sm text-xs font-semibold uppercase tracking-wider bg-eve-accent text-eve-dark hover:bg-eve-accent-hover shadow-eve-glow disabled:opacity-50 disabled:cursor-not-allowed transition-all"
        >
          {loading ? t("plexLoading") : t("plexRefresh")}
        </button>
        {/* Auto-refresh toggle */}
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setAutoRefresh(v => !v)}
            className={`px-2 py-1 rounded-sm text-[10px] font-semibold uppercase tracking-wider border transition-all ${autoRefresh ? "border-eve-success/50 bg-eve-success/10 text-eve-success" : "border-eve-border bg-eve-panel text-eve-dim hover:text-eve-text"}`}
            title={t("plexAutoRefreshHint")}
          >
            {autoRefresh ? `⟳ ${formatCountdown(countdown)}` : t("plexAutoRefresh")}
          </button>
          {autoRefresh && (
            <select
              value={autoInterval}
              onChange={(e) => setAutoInterval(Number(e.target.value))}
              className="px-1 py-0.5 bg-eve-input border border-eve-border rounded-sm text-[10px] text-eve-text"
            >
              <option value={1}>1 {t("plexMin")}</option>
              <option value={2}>2 {t("plexMin")}</option>
              <option value={5}>5 {t("plexMin")}</option>
              <option value={10}>10 {t("plexMin")}</option>
              <option value={15}>15 {t("plexMin")}</option>
              <option value={30}>30 {t("plexMin")}</option>
              <option value={60}>60 {t("plexMin")}</option>
            </select>
          )}
        </div>
        {error && <span className="text-xs text-eve-error">{error}</span>}
      </div>

      {/* NES price overrides (collapsible) */}
      {showNES && (
        <div className="flex items-center gap-3 flex-wrap shrink-0 px-2 py-1.5 bg-eve-panel/50 border border-eve-border/50 rounded-sm">
          <span className="text-[10px] text-eve-dim uppercase tracking-wider font-medium">{t("plexNESPrices")}</span>
          <div className="flex items-center gap-1.5 text-xs">
            <label className="text-eve-dim">Extractor</label>
            <input type="number" min="1" value={nesExtractor} onChange={(e) => setNesExtractor(parseInt(e.target.value) || 0)}
              className="w-16 px-1.5 py-0.5 bg-eve-input border border-eve-border rounded-sm text-xs text-eve-text font-mono" />
            <span className="text-eve-dim text-[10px]">PLEX</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <label className="text-eve-dim">MPTC</label>
            <input type="number" min="1" value={nesMPTC} onChange={(e) => setNesMPTC(parseInt(e.target.value) || 0)}
              className="w-16 px-1.5 py-0.5 bg-eve-input border border-eve-border rounded-sm text-xs text-eve-text font-mono" />
            <span className="text-eve-dim text-[10px]">PLEX</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <label className="text-eve-dim">Omega</label>
            <input type="number" min="1" value={nesOmega} onChange={(e) => setNesOmega(parseInt(e.target.value) || 0)}
              className="w-16 px-1.5 py-0.5 bg-eve-input border border-eve-border rounded-sm text-xs text-eve-text font-mono" />
            <span className="text-eve-dim text-[10px]">PLEX</span>
          </div>
          <span className="text-[10px] text-eve-dim italic">{t("plexNESHint")}</span>
        </div>
      )}

      {!dashboard && !loading && !error && (
        <div className="flex-1 flex items-center justify-center text-eve-dim text-sm">{t("plexEmpty")}</div>
      )}

      {dashboard && (
        <>
          {/* Row 1: Signal + Global PLEX Price & Indicators (merged) */}
          <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-3 shrink-0">
            {/* Signal Card */}
            {signal && <SignalCard signal={signal} indicators={ind} />}

            {/* Global PLEX Price + Technical Indicators (combined) */}
            <GlobalPriceCard price={dashboard.plex_price} indicators={ind} />
          </div>

          {/* Row 2: Interactive Price Chart */}
          <div className="bg-eve-dark border border-eve-border rounded-sm p-3 shrink-0">
            <h3 className="text-xs font-semibold text-eve-dim uppercase tracking-wider mb-2">{t("plexPriceChart")}</h3>
            <PLEXChart history={dashboard.history} overlays={dashboard.chart_overlays} themeKey={themeKey} />
          </div>

          {/* Row 3: Arbitrage Matrix + SP Farm */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] xl:grid-cols-[1fr_380px] gap-3 shrink-0">
            {/* Arbitrage Matrix with inner tabs */}
            <div className="bg-eve-dark border border-eve-border rounded-sm p-3">
              <div className="flex items-center gap-0 mb-2">
                <button
                  onClick={() => setArbTab("nes")}
                  className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${arbTab === "nes" ? "text-eve-accent border-eve-accent" : "text-eve-dim border-transparent hover:text-eve-text"}`}
                >
                  {t("plexArbTabNES")}
                </button>
                <button
                  onClick={() => setArbTab("spread")}
                  className={`px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b-2 transition-colors ${arbTab === "spread" ? "text-eve-accent border-eve-accent" : "text-eve-dim border-transparent hover:text-eve-text"}`}
                >
                  {t("plexArbTabSpread")}
                </button>
              </div>
              <div className="overflow-x-auto table-scroll-wrapper table-scroll-container">
                {arbTab === "nes" ? (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-eve-dim border-b border-eve-border">
                        <th className="text-left py-1.5 px-2 font-medium">{t("plexPath")}</th>
                        <th className="text-right py-1.5 px-2 font-medium">PLEX</th>
                        <th className="text-right py-1.5 px-2 font-medium">{t("plexCost")}</th>
                        <th className="text-right py-1.5 px-2 font-medium">{t("plexRevenue")}</th>
                        <th className="text-right py-1.5 px-2 font-medium">{t("plexProfit")}</th>
                        <th className="text-right py-1.5 px-2 font-medium">ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.arbitrage.filter(a => a.type !== "spread").map((arb, i) => (
                        <ArbitrageRow key={`nes-${i}`} arb={arb} onClick={() => setSelectedArb(arb)} />
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-eve-dim border-b border-eve-border">
                        <th className="text-left py-1.5 px-2 font-medium">{t("plexPath")}</th>
                        <th className="text-right py-1.5 px-2 font-medium">{t("plexCost")}</th>
                        <th className="text-right py-1.5 px-2 font-medium">{t("plexRevenue")}</th>
                        <th className="text-right py-1.5 px-2 font-medium">{t("plexProfit")}</th>
                        <th className="text-right py-1.5 px-2 font-medium">ROI</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dashboard.arbitrage.filter(a => a.type === "spread").map((arb, i) => (
                        <ArbitrageRow key={`spread-${i}`} arb={arb} onClick={() => setSelectedArb(arb)} />
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>

            {/* SP Farm Calculator */}
            <SPFarmCard farm={dashboard.sp_farm} />
          </div>

          {/* Row 5: Historical Arbitrage Profitability + Market Depth */}
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 shrink-0">
            {/* Historical Arb Chart */}
            {dashboard.arb_history && (
              <ArbHistoryChart data={dashboard.arb_history} themeKey={themeKey} />
            )}

            {/* Market Depth */}
            {dashboard.market_depth && (
              <MarketDepthCard depth={dashboard.market_depth} />
            )}
          </div>
        </>
      )}

      {/* Arbitrage detail modal */}
      {selectedArb && (
        <ArbitrageModal arb={selectedArb} onClose={() => setSelectedArb(null)} />
      )}
    </div>
  );
}

// ===================================================================
// Sub-components
// ===================================================================

function SignalCard({ signal, indicators }: { signal: PLEXDashboard["signal"]; indicators: PLEXIndicators | null | undefined }) {
  const { t } = useI18n();
  const colorMap = { BUY: "text-eve-success", SELL: "text-eve-error", HOLD: "text-eve-warning" };
  const bgMap = { BUY: "bg-eve-success/10 border-eve-success/30", SELL: "bg-eve-error/10 border-eve-error/30", HOLD: "bg-eve-warning/10 border-eve-warning/30" };

  return (
    <div className={`border rounded-sm p-4 flex flex-col gap-2 ${bgMap[signal.action]}`}>
      <div className="flex items-center justify-between">
        <span className="text-xs text-eve-dim uppercase tracking-wider font-medium">{t("plexSignal")}</span>
        {indicators?.ccp_sale_signal && (
          <span className="px-2 py-0.5 text-[10px] font-bold uppercase bg-eve-success/20 text-eve-success border border-eve-success/40 rounded-sm animate-pulse">
            CCP SALE
          </span>
        )}
      </div>
      <div className={`text-3xl font-bold tracking-wider ${colorMap[signal.action]}`}>
        {signal.action}
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 bg-eve-dark rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${signal.action === "BUY" ? "bg-eve-success" : signal.action === "SELL" ? "bg-eve-error" : "bg-eve-warning"}`}
            style={{ width: `${signal.confidence}%` }}
          />
        </div>
        <span className="text-xs text-eve-dim">{signal.confidence.toFixed(0)}%</span>
      </div>
      <div className="flex flex-col gap-0.5 mt-1">
        {signal.reasons.map((r, i) => (
          <span key={i} className="text-[11px] text-eve-dim leading-tight">• {r}</span>
        ))}
      </div>
    </div>
  );
}

function GlobalPriceCard({ price, indicators: ind }: { price: PLEXGlobalPrice; indicators: PLEXIndicators | null | undefined }) {
  const { t } = useI18n();
  const hasData = price.buy_price > 0 || price.sell_price > 0;
  return (
    <div className="bg-eve-dark border border-eve-accent/30 rounded-sm p-3">
      <h3 className="text-xs font-semibold text-eve-dim uppercase tracking-wider mb-3">{t("plexGlobalPrice")}</h3>
      {hasData ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <div className="text-[10px] text-eve-dim uppercase tracking-wider mb-0.5">{t("plexBestBuy")}</div>
            <div className="text-lg font-mono font-bold text-eve-success">{formatISK(price.buy_price)}</div>
            <div className="text-[10px] text-eve-dim">{price.buy_orders} {t("plexOrders")}</div>
          </div>
          <div>
            <div className="text-[10px] text-eve-dim uppercase tracking-wider mb-0.5">{t("plexBestSell")}</div>
            <div className="text-lg font-mono font-bold text-eve-error">{formatISK(price.sell_price)}</div>
            <div className="text-[10px] text-eve-dim">{price.sell_orders} {t("plexOrders")}</div>
          </div>
          <div>
            <div className="text-[10px] text-eve-dim uppercase tracking-wider mb-0.5">{t("plexSpread")}</div>
            <div className="text-lg font-mono font-bold text-eve-text">{formatISK(price.spread)}</div>
            <div className="text-[10px] text-eve-dim">{price.spread_pct.toFixed(2)}%</div>
          </div>
          <div>
            <div className="text-[10px] text-eve-dim uppercase tracking-wider mb-0.5">{t("plexVolume24h")}</div>
            <div className="text-lg font-mono font-bold text-eve-text">{price.volume_24h.toLocaleString()}</div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-eve-dim">{t("plexNoData")}</div>
      )}

      {/* Technical Indicators (inline) */}
      {ind && (
        <>
          <div className="border-t border-eve-border/30 my-3" />
          <h4 className="text-[10px] font-semibold text-eve-dim uppercase tracking-wider mb-2">{t("plexIndicators")}</h4>
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-8 gap-2">
            <MetricCell label="SMA(7)" value={formatISK(ind.sma7)} />
            <MetricCell label="SMA(30)" value={formatISK(ind.sma30)} />
            <MetricCell label="RSI(14)" value={ind.rsi.toFixed(1)} color={ind.rsi < 30 ? "text-eve-success" : ind.rsi > 70 ? "text-eve-error" : "text-eve-text"} />
            <MetricCell label="BB Upper" value={formatISK(ind.bollinger_upper)} />
            <MetricCell label="BB Lower" value={formatISK(ind.bollinger_lower)} />
            <MetricCell label="24h" value={`${ind.change_24h >= 0 ? "+" : ""}${ind.change_24h.toFixed(2)}%`} color={ind.change_24h >= 0 ? "text-eve-success" : "text-eve-error"} />
            <MetricCell label="7d" value={`${ind.change_7d >= 0 ? "+" : ""}${ind.change_7d.toFixed(2)}%`} color={ind.change_7d >= 0 ? "text-eve-success" : "text-eve-error"} />
            <MetricCell label="30d" value={`${ind.change_30d >= 0 ? "+" : ""}${ind.change_30d.toFixed(2)}%`} color={ind.change_30d >= 0 ? "text-eve-success" : "text-eve-error"} />
          </div>
        </>
      )}
    </div>
  );
}

function ArbitrageRow({ arb, onClick }: { arb: ArbitragePath; onClick: () => void }) {
  return (
    <tr className={`border-b border-eve-border/50 hover:bg-eve-panel/50 transition-colors cursor-pointer ${arb.viable ? "" : arb.no_data ? "opacity-40" : "opacity-50"}`} onClick={onClick}>
      <td className="py-1.5 px-2">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${arb.no_data ? "bg-eve-warning" : arb.viable ? "bg-eve-success" : "bg-eve-error"}`} />
          <span className="text-eve-text hover:text-eve-accent transition-colors">{arb.name}</span>
          {arb.no_data && <span className="text-[9px] text-eve-warning uppercase tracking-wider">no data</span>}
        </div>
      </td>
      <td className="py-1.5 px-2 text-right font-mono text-eve-dim">{arb.plex_cost > 0 ? arb.plex_cost : "—"}</td>
      <td className="py-1.5 px-2 text-right font-mono text-eve-text">{arb.no_data ? "—" : formatISK(arb.cost_isk)}</td>
      <td className="py-1.5 px-2 text-right font-mono text-eve-text">{arb.no_data ? "—" : formatISK(arb.revenue_isk)}</td>
      <td className={`py-1.5 px-2 text-right font-mono font-semibold ${arb.no_data ? "text-eve-dim" : arb.profit_isk >= 0 ? "text-eve-success" : "text-eve-error"}`}>
        {arb.no_data ? "—" : `${arb.profit_isk >= 0 ? "+" : ""}${formatISK(arb.profit_isk)}`}
      </td>
      <td className={`py-1.5 px-2 text-right font-mono font-semibold ${arb.no_data ? "text-eve-dim" : arb.roi >= 0 ? "text-eve-success" : "text-eve-error"}`}>
        {arb.no_data ? "—" : `${arb.roi >= 0 ? "+" : ""}${arb.roi.toFixed(1)}%`}
      </td>
    </tr>
  );
}

function SPFarmCard({ farm }: { farm: PLEXDashboard["sp_farm"] }) {
  const { t } = useI18n();
  const [numChars, setNumChars] = useState(1);
  const [sellMode, setSellMode] = useState<"order" | "instant">("order");

  // Per-char profit based on sell mode (fallback to 0 for fields that may be missing from old cached responses)
  const perCharProfit = sellMode === "instant" ? (farm.instant_sell_profit_isk ?? 0) : farm.profit_isk;
  const perCharROI = sellMode === "instant" ? (farm.instant_sell_roi ?? 0) : farm.roi;
  const perCharRevenue = sellMode === "instant" ? (farm.instant_sell_revenue_isk ?? 0) : farm.revenue_isk;
  const isViable = perCharProfit > 0;

  // Multi-char scaling: 1st char uses Omega only, extras also need MPTC each
  const mptcCost = farm.mptc_cost_isk ?? 0;
  const totalMonthlyCost = farm.total_cost_isk + (numChars > 1 ? (numChars - 1) * (farm.total_cost_isk + mptcCost) : 0);
  const totalMonthlyRevenue = numChars * perCharRevenue;
  const totalMonthlyProfit = totalMonthlyRevenue - totalMonthlyCost;

  return (
    <div className={`border rounded-sm p-3 ${isViable ? "border-eve-success/30 bg-eve-success/5" : "border-eve-error/30 bg-eve-error/5"}`}>
      <h3 className="text-xs font-semibold text-eve-dim uppercase tracking-wider mb-2">{t("plexSPFarm")}</h3>
      <div className="space-y-1 text-xs">
        <Row label={t("plexOmegaCost")} value={`${farm.omega_cost_plex} PLEX = ${formatISK(farm.omega_cost_isk)}`} />
        <Row label={t("plexExtractors")} value={`${farm.extractors_per_month.toFixed(1)}x @ ${farm.extractor_cost_plex} PLEX`} />
        <Row label={t("plexTotalCost")} value={formatISK(farm.total_cost_isk)} dim />
        <div className="border-t border-eve-border/50 my-1.5" />
        <Row label={t("plexInjectors")} value={`${farm.injectors_produced.toFixed(1)}x @ ${formatISK(farm.injector_sell_price)}`} />
        <Row label={t("plexRevenue")} value={formatISK(perCharRevenue)} dim />

        {/* Sell mode toggle */}
        <div className="flex items-center gap-2 mt-1">
          <button
            onClick={() => setSellMode("order")}
            className={`px-2 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wider border transition-all ${sellMode === "order" ? "border-eve-accent/50 bg-eve-accent/10 text-eve-accent" : "border-eve-border bg-eve-panel text-eve-dim hover:text-eve-text"}`}
          >
            {t("plexSellOrder")}
          </button>
          <button
            onClick={() => setSellMode("instant")}
            className={`px-2 py-0.5 rounded-sm text-[10px] font-semibold uppercase tracking-wider border transition-all ${sellMode === "instant" ? "border-eve-warning/50 bg-eve-warning/10 text-eve-warning" : "border-eve-border bg-eve-panel text-eve-dim hover:text-eve-text"}`}
          >
            {t("plexInstantSell")}
          </button>
          {sellMode === "instant" && (
            <span className="text-[9px] text-eve-dim italic">{t("plexInstantSellNote")}</span>
          )}
        </div>

        <div className="border-t border-eve-border/50 my-1.5" />
        <div className="flex justify-between items-center">
          <span className="font-semibold text-eve-text">{t("plexNetProfit")}</span>
          <span className={`font-mono font-bold text-sm ${isViable ? "text-eve-success" : "text-eve-error"}`}>
            {perCharProfit >= 0 ? "+" : ""}{formatISK(perCharProfit)}/mo
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-eve-dim">{t("plexPerDay")}</span>
          <span className={`font-mono ${isViable ? "text-eve-success" : "text-eve-error"}`}>
            {formatISK(perCharProfit / 30)}/day
          </span>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-eve-dim">ROI</span>
          <span className={`font-mono font-semibold ${perCharROI > 0 ? "text-eve-success" : "text-eve-error"}`}>
            {perCharROI > 0 ? "+" : ""}{perCharROI.toFixed(1)}%
          </span>
        </div>

        {/* +5 implants */}
        <div className="border-t border-eve-border/30 my-1.5" />
        <div className="text-[11px] text-eve-dim">
          {t("plexWithImplants")}:
          <span className={`ml-1 font-mono ${farm.profit_plus5 > 0 ? "text-eve-success" : "text-eve-error"}`}>
            {farm.profit_plus5 >= 0 ? "+" : ""}{formatISK(farm.profit_plus5)}/mo
          </span>
          <span className="mx-1">|</span>
          <span className={`font-mono ${farm.roi_plus5 > 0 ? "text-eve-success" : "text-eve-error"}`}>
            {farm.roi_plus5 > 0 ? "+" : ""}{farm.roi_plus5.toFixed(1)}%
          </span>
        </div>

        {/* Startup cost & payback */}
        {(farm.startup_train_days ?? 0) > 0 && (
          <>
            <div className="border-t border-eve-border/30 my-1.5" />
            <div className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-1">{t("plexStartupCost")}</div>
            <Row label={t("plexStartupTrainDays")} value={`~${Math.ceil(farm.startup_train_days)} ${t("plexDays")} (~${(farm.startup_train_days / 30).toFixed(1)} ${t("plexMonths")})`} />
            <Row label={t("plexStartupCost")} value={formatISK(farm.startup_cost_isk ?? 0)} />
            {(farm.payback_days ?? 0) > 0 && (
              <Row label={t("plexPaybackPeriod")} value={`~${Math.ceil(farm.payback_days)} ${t("plexDays")} (~${(farm.payback_days / 30).toFixed(1)} ${t("plexMonths")})`} />
            )}
          </>
        )}

        {/* Multi-character scaling */}
        <div className="border-t border-eve-border/30 my-1.5" />
        <div className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-1">{t("plexMultiChar")}</div>
        <div className="flex items-center gap-2">
          <label className="text-eve-dim text-[11px]">{t("plexNumChars")}</label>
          <input
            type="number"
            min="1"
            max="50"
            value={numChars}
            onChange={(e) => setNumChars(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-14 px-1.5 py-0.5 bg-eve-input border border-eve-border rounded-sm text-xs text-eve-text font-mono text-center"
          />
          {numChars > 1 && (
            <span className="text-[10px] text-eve-dim">
              ({t("plexMPTCperChar")}: {farm.mptc_cost_plex ?? 0} PLEX = {formatISK(mptcCost)})
            </span>
          )}
        </div>
        {numChars > 1 && (
          <div className="flex justify-between items-center mt-1">
            <span className="font-semibold text-eve-text text-[11px]">{t("plexTotalMonthlyProfit")} ({numChars}x)</span>
            <span className={`font-mono font-bold ${totalMonthlyProfit > 0 ? "text-eve-success" : "text-eve-error"}`}>
              {totalMonthlyProfit >= 0 ? "+" : ""}{formatISK(totalMonthlyProfit)}/mo
            </span>
          </div>
        )}

        {/* Omega ISK equivalent */}
        {(farm.omega_isk_value ?? 0) > 0 && (
          <>
            <div className="border-t border-eve-border/30 my-1.5" />
            <div className="text-[11px] text-eve-dim">
              {t("plexOmegaISKValue").replace("{plex}", String(farm.omega_cost_plex)).replace("{isk}", formatISK(farm.omega_isk_value))}
              {(farm.plex_unit_price ?? 0) > 0 && (
                <span className="ml-1">({formatISK(farm.plex_unit_price)} {t("plexPerPLEX")})</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, dim }: { label: string; value: string; dim?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-eve-dim">{label}</span>
      <span className={`font-mono ${dim ? "text-eve-dim" : "text-eve-text"}`}>{value}</span>
    </div>
  );
}

function MetricCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="text-center">
      <div className="text-[10px] text-eve-dim uppercase tracking-wider">{label}</div>
      <div className={`text-sm font-mono font-semibold ${color || "text-eve-text"}`}>{value}</div>
    </div>
  );
}

// ===================================================================
// Historical Arbitrage Profitability Chart
// ===================================================================

function ArbHistoryChart({ data, themeKey }: { data: ArbHistoryData; themeKey?: string }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const hasData = (data.extractor_nes?.length ?? 0) > 0 ||
                    (data.sp_chain_nes?.length ?? 0) > 0 ||
                    (data.mptc_nes?.length ?? 0) > 0 ||
                    (data.sp_farm_profit?.length ?? 0) > 0;
    if (!hasData) return;

    const bgColor = cssColor("--eve-dark", "#0d1117");
    const txtColor = cssColor("--eve-dim", "#484f58");
    const grdColor = cssColor("--eve-border", "#21262d");

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: bgColor },
        textColor: txtColor,
        fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
        fontSize: 10,
      },
      grid: { vertLines: { color: grdColor }, horzLines: { color: grdColor } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: grdColor, scaleMargins: { top: 0.1, bottom: 0.1 } },
      timeScale: { borderColor: grdColor, timeVisible: false, fixLeftEdge: true, fixRightEdge: true },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });
    chartRef.current = chart;

    // Add zero line for reference
    const toLD = (pts: { date: string; profit_isk: number }[] | undefined): LineData<Time>[] =>
      pts?.map((p) => ({ time: p.date as Time, value: p.profit_isk })) ?? [];

    // NES Extractor — cyan
    if (data.extractor_nes?.length) {
      const s = chart.addSeries(LineSeries, { color: "#56d4dd", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true });
      s.setData(toLD(data.extractor_nes));
    }

    // SP Chain — purple
    if (data.sp_chain_nes?.length) {
      const s = chart.addSeries(LineSeries, { color: "#bc8cff", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true });
      s.setData(toLD(data.sp_chain_nes));
    }

    // MPTC — orange
    if (data.mptc_nes?.length) {
      const s = chart.addSeries(LineSeries, { color: "#d29922", lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: true });
      s.setData(toLD(data.mptc_nes));
    }

    // SP Farm monthly — green (thicker, most important)
    if (data.sp_farm_profit?.length) {
      const s = chart.addSeries(LineSeries, { color: "#3fb950", lineWidth: 2, priceLineVisible: true, lastValueVisible: true, crosshairMarkerVisible: true });
      s.setData(toLD(data.sp_farm_profit));
    }

    chart.timeScale().fitContent();

    // Resize observer
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        chartRef.current.resize(width, height);
      }
    });
    if (containerRef.current) ro.observe(containerRef.current);

    return () => { ro.disconnect(); chart.remove(); chartRef.current = null; };
  }, [data, themeKey]);

  return (
    <div className="bg-eve-dark border border-eve-border rounded-sm p-3">
      <h3 className="text-xs font-semibold text-eve-dim uppercase tracking-wider mb-1">{t("plexArbHistory")}</h3>
      <p className="text-[10px] text-eve-dim mb-2">{t("plexArbHistoryHint")}</p>
      {/* Legend */}
      <div className="flex items-center gap-3 mb-2 flex-wrap">
        <LegendDot color="#56d4dd" label={t("plexArbHistNES")} />
        <LegendDot color="#bc8cff" label={t("plexArbHistSP")} />
        <LegendDot color="#d29922" label={t("plexArbHistMPTC")} />
        <LegendDot color="#3fb950" label={t("plexArbHistSPFarm")} />
      </div>
      <div ref={containerRef} className="w-full rounded-sm h-[150px] sm:h-[180px] lg:h-[200px]" />
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[10px] text-eve-dim">{label}</span>
    </div>
  );
}

// ===================================================================
// Market Depth Card
// ===================================================================

function MarketDepthCard({ depth }: { depth: MarketDepthInfo }) {
  const { t } = useI18n();
  return (
    <div className="bg-eve-dark border border-eve-border rounded-sm p-3">
      <h3 className="text-xs font-semibold text-eve-dim uppercase tracking-wider mb-1">{t("plexMarketDepth")}</h3>
      <p className="text-[10px] text-eve-dim mb-2">{t("plexMarketDepthHint")}</p>
      <div className="space-y-2 text-xs">
        {/* PLEX sell depth */}
        <div className="border border-eve-border/50 rounded-sm p-2">
          <div className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-1">{t("plexDepthPLEX")} {t("plexDepthSellOrders")}</div>
          <div className="flex justify-between">
            <span className="text-eve-dim">{t("plexDepthVolume")}</span>
            <span className="font-mono text-eve-text">{depth.plex_sell_depth_5.total_volume.toLocaleString()}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-eve-dim">{t("plexDepthLevels")}</span>
            <span className="font-mono text-eve-text">{depth.plex_sell_depth_5.levels}</span>
          </div>
          {depth.plex_sell_depth_5.best_price > 0 && (
            <div className="flex justify-between">
              <span className="text-eve-dim">Best → Worst</span>
              <span className="font-mono text-eve-text text-[11px]">{formatISK(depth.plex_sell_depth_5.best_price)} → {formatISK(depth.plex_sell_depth_5.worst_price)}</span>
            </div>
          )}
        </div>

        {/* Item depth grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-1.5">
          <DepthItem label={t("plexDepthExtractor")} sell={depth.extractor_sell_qty} buy={depth.extractor_buy_qty} />
          <DepthItem label={t("plexDepthInjector")} sell={depth.injector_sell_qty} buy={depth.injector_buy_qty} />
          <DepthItem label={t("plexDepthMPTC")} sell={depth.mptc_sell_qty} buy={depth.mptc_buy_qty} />
        </div>
      </div>
    </div>
  );
}

function DepthItem({ label, sell, buy }: { label: string; sell: number; buy: number }) {
  const { t } = useI18n();
  return (
    <div className="border border-eve-border/30 rounded-sm p-1.5 text-center">
      <div className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-1">{label}</div>
      <div className="text-[10px]">
        <span className="text-eve-error">{t("plexDepthSellOrders").charAt(0)}: </span>
        <span className="font-mono text-eve-text">{sell.toLocaleString()}</span>
      </div>
      <div className="text-[10px]">
        <span className="text-eve-success">{t("plexDepthBuyOrders").charAt(0)}: </span>
        <span className="font-mono text-eve-text">{buy.toLocaleString()}</span>
      </div>
    </div>
  );
}

// ===================================================================
// Arbitrage Detail Modal
// ===================================================================

/** Build flow steps based on arbitrage type */
function getFlowSteps(arb: ArbitragePath): { label: string; sub: string; color: string }[] {
  const costStr = formatISK(arb.cost_isk);
  const revStr = formatISK(arb.revenue_isk);

  if (arb.type === "nes_sell" && arb.name.includes("Extractor")) {
    return [
      { label: "Buy PLEX", sub: `${arb.plex_cost} PLEX × market`, color: "border-eve-accent/40 bg-eve-accent/5" },
      { label: "NES Store", sub: `Spend ${arb.plex_cost} PLEX`, color: "border-eve-warning/40 bg-eve-warning/5" },
      { label: "Skill Extractor", sub: "Receive 1 item", color: "border-blue-500/40 bg-blue-500/5" },
      { label: "Sell on Market", sub: `${revStr} ISK`, color: "border-eve-success/40 bg-eve-success/5" },
    ];
  }
  if (arb.type === "nes_process") {
    return [
      { label: "Buy PLEX", sub: `${arb.plex_cost} PLEX × market`, color: "border-eve-accent/40 bg-eve-accent/5" },
      { label: "NES Store", sub: `Spend ${arb.plex_cost} PLEX`, color: "border-eve-warning/40 bg-eve-warning/5" },
      { label: "Skill Extractor", sub: "Receive 1 item", color: "border-blue-500/40 bg-blue-500/5" },
      { label: "Extract SP", sub: "500,000 SP from char", color: "border-purple-500/40 bg-purple-500/5" },
      { label: "Large Skill Injector", sub: "Created from SP", color: "border-cyan-500/40 bg-cyan-500/5" },
      { label: "Sell on Market", sub: `${revStr} ISK`, color: "border-eve-success/40 bg-eve-success/5" },
    ];
  }
  if (arb.type === "market_process") {
    return [
      { label: "Buy Extractor", sub: `${formatISK(arb.cost_isk)} ISK`, color: "border-eve-accent/40 bg-eve-accent/5" },
      { label: "Extract SP", sub: "500,000 SP from char", color: "border-purple-500/40 bg-purple-500/5" },
      { label: "Large Skill Injector", sub: "Created from SP", color: "border-cyan-500/40 bg-cyan-500/5" },
      { label: "Sell on Market", sub: `${revStr} ISK`, color: "border-eve-success/40 bg-eve-success/5" },
    ];
  }
  if (arb.type === "nes_sell" && arb.name.includes("MPTC")) {
    return [
      { label: "Buy PLEX", sub: `${arb.plex_cost} PLEX × market`, color: "border-eve-accent/40 bg-eve-accent/5" },
      { label: "NES Store", sub: `Spend ${arb.plex_cost} PLEX`, color: "border-eve-warning/40 bg-eve-warning/5" },
      { label: "MPTC", sub: "Receive 1 certificate", color: "border-blue-500/40 bg-blue-500/5" },
      { label: "Sell on Market", sub: `${revStr} ISK`, color: "border-eve-success/40 bg-eve-success/5" },
    ];
  }
  if (arb.type === "spread") {
    // Extract item name from arb name (e.g. "PLEX Spread ..." → "PLEX")
    const itemName = arb.name.split(" ")[0];
    return [
      { label: `Buy Order`, sub: `${costStr} ISK`, color: "border-eve-success/40 bg-eve-success/5" },
      { label: itemName, sub: "Wait for fill", color: "border-blue-500/40 bg-blue-500/5" },
      { label: `Sell Order`, sub: `${formatISK(arb.revenue_gross)} ISK`, color: "border-eve-error/40 bg-eve-error/5" },
      { label: "Profit", sub: `${formatISK(arb.profit_isk)} ISK`, color: arb.viable ? "border-eve-success/40 bg-eve-success/5" : "border-eve-error/40 bg-eve-error/5" },
    ];
  }
  // Fallback
  return [
    { label: "Cost", sub: costStr, color: "border-eve-error/40 bg-eve-error/5" },
    { label: "Revenue", sub: revStr, color: "border-eve-success/40 bg-eve-success/5" },
  ];
}

function ArbitrageModal({ arb, onClose }: { arb: ArbitragePath; onClose: () => void }) {
  const { t } = useI18n();
  const steps = getFlowSteps(arb);

  // Close on Escape key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      {/* Modal */}
      <div
        className="relative bg-eve-dark border border-eve-border rounded-sm shadow-2xl w-full max-w-2xl max-h-[95vh] sm:max-h-[90vh] mx-2 sm:mx-0 overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-eve-border">
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${arb.viable ? "bg-eve-success" : "bg-eve-error"}`} />
            <h2 className="text-sm font-semibold text-eve-text uppercase tracking-wider">{arb.name}</h2>
          </div>
          <button onClick={onClose} className="text-eve-dim hover:text-eve-text transition-colors text-lg leading-none px-1">&times;</button>
        </div>

        {/* Flow diagram */}
        <div className="p-4">
          <h3 className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-3">{t("plexArbFlow")}</h3>
          <div className="flex items-stretch gap-0 overflow-x-auto pb-2">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center shrink-0">
                {/* Step box */}
                <div className={`border rounded-sm px-2 py-2 sm:px-3 sm:py-2.5 min-w-[80px] sm:min-w-[110px] text-center ${step.color}`}>
                  <div className="text-xs font-semibold text-eve-text whitespace-nowrap">{step.label}</div>
                  <div className="text-[10px] text-eve-dim mt-0.5 whitespace-nowrap">{step.sub}</div>
                </div>
                {/* Arrow */}
                {i < steps.length - 1 && (
                  <div className="flex items-center px-1 text-eve-dim shrink-0">
                    <svg width="20" height="12" viewBox="0 0 20 12" fill="none" className="text-eve-dim">
                      <path d="M0 6H16M16 6L11 1M16 6L11 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Financial breakdown */}
        <div className="px-4 pb-4">
          <h3 className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-3">{t("plexArbBreakdown")}</h3>
          <div className="grid grid-cols-2 gap-3">
            {/* Cost side */}
            <div className="border border-eve-error/20 bg-eve-error/5 rounded-sm p-3">
              <div className="text-[10px] text-eve-error uppercase tracking-wider font-medium mb-2">{t("plexCost")}</div>
              <div className="space-y-1.5 text-xs">
                {arb.type === "spread" ? (
                  <>
                    <div className="flex justify-between">
                      <span className="text-eve-dim">Buy order + broker</span>
                      <span className="font-mono text-eve-text">{formatISK(arb.cost_isk)}</span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="flex justify-between">
                      <span className="text-eve-dim">PLEX needed</span>
                      <span className="font-mono text-eve-text">{arb.plex_cost}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-eve-dim">{arb.type === "market_process" ? "Market cost" : "PLEX cost (market)"}</span>
                      <span className="font-mono text-eve-text">{formatISK(arb.cost_isk)}</span>
                    </div>
                  </>
                )}
                {(arb.type === "nes_process" || arb.type === "market_process") && (
                  <div className="flex justify-between">
                    <span className="text-eve-dim">Requires char with</span>
                    <span className="font-mono text-eve-text">&ge; 5.5M SP</span>
                  </div>
                )}
              </div>
            </div>

            {/* Revenue side */}
            <div className="border border-eve-success/20 bg-eve-success/5 rounded-sm p-3">
              <div className="text-[10px] text-eve-success uppercase tracking-wider font-medium mb-2">{t("plexRevenue")}</div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-eve-dim">Sell price (Jita)</span>
                  <span className="font-mono text-eve-text">{formatISK(arb.revenue_gross)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-eve-dim">After tax + broker</span>
                  <span className="font-mono text-eve-text">{formatISK(arb.revenue_isk)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Result */}
          <div className={`mt-3 border rounded-sm p-3 ${arb.viable ? "border-eve-success/30 bg-eve-success/5" : "border-eve-error/30 bg-eve-error/5"}`}>
            <div className="flex items-center justify-between">
              <div>
                <div className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-1">{t("plexProfit")}</div>
                <div className={`text-xl font-mono font-bold ${arb.viable ? "text-eve-success" : "text-eve-error"}`}>
                  {arb.profit_isk >= 0 ? "+" : ""}{formatISK(arb.profit_isk)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-1">ROI</div>
                <div className={`text-xl font-mono font-bold ${arb.viable ? "text-eve-success" : "text-eve-error"}`}>
                  {arb.roi >= 0 ? "+" : ""}{arb.roi.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>

          {/* Tips */}
          <div className="mt-3 text-[11px] text-eve-dim leading-relaxed space-y-1">
            <div className="text-[10px] text-eve-dim uppercase tracking-wider font-medium mb-1">{t("plexArbTips")}</div>
            {arb.type === "nes_sell" && arb.name.includes("Extractor") && (
              <>
                <p>• {t("plexTipExtractor1")}</p>
                <p>• {t("plexTipExtractor2")}</p>
              </>
            )}
            {arb.type === "nes_process" && (
              <>
                <p>• {t("plexTipSPChain1")}</p>
                <p>• {t("plexTipSPChain2")}</p>
                <p>• {t("plexTipSPChain3")}</p>
              </>
            )}
            {arb.type === "market_process" && (
              <>
                <p>• {t("plexTipMarket1")}</p>
                <p>• {t("plexTipSPChain1")}</p>
                <p>• {t("plexTipSPChain3")}</p>
              </>
            )}
            {arb.type === "nes_sell" && arb.name.includes("MPTC") && (
              <>
                <p>• {t("plexTipMPTC1")}</p>
                <p>• {t("plexTipMPTC2")}</p>
              </>
            )}
            {arb.type === "spread" && (
              <>
                <p>• {t("plexTipSpread1")}</p>
                <p>• {t("plexTipSpread2")}</p>
                <p>• {t("plexTipSpread3")}</p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ===================================================================
// Interactive TradingView Lightweight Chart
// (uses pre-computed overlays from backend; no frontend SMA/BB math)
// ===================================================================

/** Read a CSS RGB-triplet variable as hex color for lightweight-charts */
function cssColor(name: string, fallback: string): string {
  const val = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!val) return fallback;
  const parts = val.split(/\s+/).map(Number);
  if (parts.length === 3 && parts.every(n => !isNaN(n))) {
    return `#${parts.map(n => n.toString(16).padStart(2, "0")).join("")}`;
  }
  return fallback;
}

/** Convert backend overlay points to lightweight-charts LineData format */
function toLineData(points: { date: string; value: number }[] | undefined): LineData<Time>[] {
  if (!points?.length) return [];
  return points.map((p) => ({ time: p.date as Time, value: p.value }));
}

function PLEXChart({ history, overlays, themeKey }: { history: PricePoint[]; overlays?: ChartOverlays | null; themeKey?: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<{
    price?: ISeriesApi<"Line">;
    sma7?: ISeriesApi<"Line">;
    sma30?: ISeriesApi<"Line">;
    bbUpper?: ISeriesApi<"Line">;
    bbLower?: ISeriesApi<"Line">;
    volume?: ISeriesApi<"Histogram">;
  }>({});

  useEffect(() => {
    if (!containerRef.current || history.length === 0) return;

    // Read theme colors from CSS variables
    const bgColor = cssColor("--eve-dark", "#0d1117");
    const textColor = cssColor("--eve-dim", "#484f58");
    const gridColor = cssColor("--eve-border", "#21262d");
    const accentColor = cssColor("--eve-accent", "#e69500");

    // Create chart
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: bgColor },
        textColor,
        fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: gridColor },
        horzLines: { color: gridColor },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: accentColor + "40", width: 1, style: LineStyle.Dashed, labelBackgroundColor: accentColor },
        horzLine: { color: accentColor + "40", width: 1, style: LineStyle.Dashed, labelBackgroundColor: accentColor },
      },
      rightPriceScale: {
        borderColor: gridColor,
        scaleMargins: { top: 0.1, bottom: 0.2 },
      },
      timeScale: {
        borderColor: gridColor,
        timeVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScale: { axisPressedMouseMove: { time: true, price: true } },
      handleScroll: { mouseWheel: true, pressedMouseMove: true },
    });
    chartRef.current = chart;

    // Bollinger Bands from backend (draw first so they appear behind)
    const bbUpperData = toLineData(overlays?.bollinger_upper);
    const bbLowerData = toLineData(overlays?.bollinger_lower);
    if (bbUpperData.length > 0) {
      const bbUpperSeries = chart.addSeries(LineSeries, {
        color: accentColor + "40",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      bbUpperSeries.setData(bbUpperData);
      seriesRef.current.bbUpper = bbUpperSeries;
    }
    if (bbLowerData.length > 0) {
      const bbLowerSeries = chart.addSeries(LineSeries, {
        color: accentColor + "40",
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      bbLowerSeries.setData(bbLowerData);
      seriesRef.current.bbLower = bbLowerSeries;
    }

    // SMA(30) from backend
    const successColor = cssColor("--eve-success", "#3fb950");
    const warningColor = cssColor("--eve-warning", "#d29922");
    const errorColor = cssColor("--eve-error", "#dc3c3c");

    const sma30Data = toLineData(overlays?.sma30);
    if (sma30Data.length > 0) {
      const sma30Series = chart.addSeries(LineSeries, {
        color: warningColor,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      sma30Series.setData(sma30Data);
      seriesRef.current.sma30 = sma30Series;
    }

    // SMA(7) from backend
    const sma7Data = toLineData(overlays?.sma7);
    if (sma7Data.length > 0) {
      const sma7Series = chart.addSeries(LineSeries, {
        color: successColor,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      sma7Series.setData(sma7Data);
      seriesRef.current.sma7 = sma7Series;
    }

    // Main price line — accent color
    const priceSeries = chart.addSeries(LineSeries, {
      color: accentColor,
      lineWidth: 2,
      priceLineVisible: true,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      crosshairMarkerRadius: 4,
    });
    priceSeries.setData(
      history.map((p) => ({ time: p.date as Time, value: p.average }))
    );
    seriesRef.current.price = priceSeries;

    // Volume histogram on a separate price scale
    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: accentColor + "30",
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    volumeSeries.priceScale().applyOptions({
      scaleMargins: { top: 0.85, bottom: 0 },
    });
    volumeSeries.setData(
      history.map((p, i) => ({
        time: p.date as Time,
        value: p.volume,
        color: i > 0 && p.average >= history[i - 1].average ? successColor + "40" : errorColor + "40",
      }))
    );
    seriesRef.current.volume = volumeSeries;

    // Fit content
    chart.timeScale().fitContent();

    // Handle container resize
    const ro = new ResizeObserver(() => {
      if (containerRef.current && chartRef.current) {
        const { width, height } = containerRef.current.getBoundingClientRect();
        chartRef.current.resize(width, height);
      }
    });
    if (containerRef.current) {
      ro.observe(containerRef.current);
    }

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = {};
    };
  }, [history, overlays, themeKey]);

  return (
    <div
      ref={containerRef}
      className="w-full rounded-sm h-[200px] sm:h-[250px] lg:h-[300px]"
    />
  );
}
