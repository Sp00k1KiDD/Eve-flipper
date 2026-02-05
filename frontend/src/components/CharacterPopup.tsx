import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { getCharacterInfo } from "../lib/api";
import { useI18n, type TranslationKey } from "../lib/i18n";
import type { CharacterInfo, CharacterOrder, HistoricalOrder, WalletTransaction } from "../lib/types";

interface CharacterPopupProps {
  open: boolean;
  onClose: () => void;
  characterId: number;
  characterName: string;
}

type CharTab = "overview" | "orders" | "history" | "transactions" | "risk";

export function CharacterPopup({ open, onClose, characterId, characterName }: CharacterPopupProps) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CharacterInfo | null>(null);
  const [tab, setTab] = useState<CharTab>("overview");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    getCharacterInfo()
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [open]);

  const formatIsk = (value: number) => {
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
    return value.toFixed(0);
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString() + " " + d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  };

  const buyOrders = data?.orders.filter((o) => o.is_buy_order) ?? [];
  const sellOrders = data?.orders.filter((o) => !o.is_buy_order) ?? [];
  const totalBuyValue = buyOrders.reduce((sum, o) => sum + o.price * o.volume_remain, 0);
  const totalSellValue = sellOrders.reduce((sum, o) => sum + o.price * o.volume_remain, 0);
  const totalEscrow = totalBuyValue; // buy orders have ISK in escrow

  // Calculate profit from recent transactions
  const recentTxns = data?.transactions ?? [];
  const buyTxns = recentTxns.filter((t) => t.is_buy);
  const sellTxns = recentTxns.filter((t) => !t.is_buy);
  const totalBought = buyTxns.reduce((sum, t) => sum + t.unit_price * t.quantity, 0);
  const totalSold = sellTxns.reduce((sum, t) => sum + t.unit_price * t.quantity, 0);

  return (
    <Modal open={open} onClose={onClose} title={characterName} width="max-w-4xl">
      <div className="flex flex-col h-[70vh]">
        {/* Tabs */}
        <div className="flex border-b border-eve-border bg-eve-panel">
          <TabBtn active={tab === "overview"} onClick={() => setTab("overview")} label={t("charOverview")} />
          <TabBtn active={tab === "orders"} onClick={() => setTab("orders")} label={`${t("charActiveOrders")} (${data?.orders.length ?? 0})`} />
          <TabBtn active={tab === "history"} onClick={() => setTab("history")} label={`${t("charOrderHistory")} (${data?.order_history?.length ?? 0})`} />
          <TabBtn active={tab === "transactions"} onClick={() => setTab("transactions")} label={`${t("charTransactions")} (${data?.transactions?.length ?? 0})`} />
          <TabBtn active={tab === "risk"} onClick={() => setTab("risk")} label={t("charRiskTab")} />
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto p-4">
          {loading && (
            <div className="flex items-center justify-center h-full text-eve-dim">{t("loading")}...</div>
          )}
          {error && (
            <div className="flex items-center justify-center h-full text-eve-error">{error}</div>
          )}
          {data && !loading && (
            <>
              {tab === "overview" && (
                <OverviewTab
                  data={data}
                  characterId={characterId}
                  formatIsk={formatIsk}
                  buyOrders={buyOrders}
                  sellOrders={sellOrders}
                  totalBuyValue={totalBuyValue}
                  totalSellValue={totalSellValue}
                  totalEscrow={totalEscrow}
                  totalBought={totalBought}
                  totalSold={totalSold}
                  t={t}
                />
              )}
              {tab === "orders" && (
                <OrdersTab orders={data.orders} formatIsk={formatIsk} formatDate={formatDate} t={t} />
              )}
              {tab === "history" && (
                <HistoryTab history={data.order_history ?? []} formatIsk={formatIsk} formatDate={formatDate} t={t} />
              )}
              {tab === "transactions" && (
                <TransactionsTab transactions={data.transactions ?? []} formatIsk={formatIsk} formatDate={formatDate} t={t} />
              )}
              {tab === "risk" && (
                <RiskTab
                  characterId={characterId}
                  data={data}
                  formatIsk={formatIsk}
                  t={t}
                />
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}

function TabBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-xs font-medium transition-colors ${
        active
          ? "text-eve-accent border-b-2 border-eve-accent bg-eve-dark/50"
          : "text-eve-dim hover:text-eve-text"
      }`}
    >
      {label}
    </button>
  );
}

interface OverviewTabProps {
  data: CharacterInfo;
  characterId: number;
  formatIsk: (v: number) => string;
  buyOrders: CharacterOrder[];
  sellOrders: CharacterOrder[];
  totalBuyValue: number;
  totalSellValue: number;
  totalEscrow: number;
  totalBought: number;
  totalSold: number;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function OverviewTab({
  data,
  characterId,
  formatIsk,
  buyOrders,
  sellOrders,
  totalBuyValue,
  totalSellValue,
  totalEscrow,
  totalBought,
  totalSold,
  t,
}: OverviewTabProps) {
  const netWorth = data.wallet + totalSellValue + totalEscrow;
  const tradingProfit = totalSold - totalBought;

  return (
    <div className="space-y-4">
      {/* Character Header */}
      <div className="flex items-center gap-4 p-4 bg-eve-panel border border-eve-border rounded-sm">
        <img
          src={`https://images.evetech.net/characters/${characterId}/portrait?size=128`}
          alt=""
          className="w-16 h-16 rounded-sm"
        />
        <div>
          <h2 className="text-lg font-bold text-eve-text">{data.character_name}</h2>
          {data.skills && (
            <div className="text-sm text-eve-dim">{formatIsk(data.skills.total_sp)} SP</div>
          )}
        </div>
      </div>

      {/* Financial Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={t("charWallet")} value={`${formatIsk(data.wallet)} ISK`} color="text-eve-profit" />
        <StatCard label={t("charEscrow")} value={`${formatIsk(totalEscrow)} ISK`} color="text-eve-warning" />
        <StatCard label={t("charSellOrdersValue")} value={`${formatIsk(totalSellValue)} ISK`} color="text-eve-accent" />
        <StatCard label={t("charNetWorth")} value={`${formatIsk(netWorth)} ISK`} color="text-eve-profit" large />
      </div>

      {/* Orders Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label={t("charBuyOrders")} value={String(buyOrders.length)} subvalue={`${formatIsk(totalBuyValue)} ISK`} />
        <StatCard label={t("charSellOrders")} value={String(sellOrders.length)} subvalue={`${formatIsk(totalSellValue)} ISK`} />
        <StatCard label={t("charTotalOrders")} value={String(data.orders.length)} subvalue={`${formatIsk(totalBuyValue + totalSellValue)} ISK`} />
        <StatCard
          label={t("charTradingProfit")}
          value={`${tradingProfit >= 0 ? "+" : ""}${formatIsk(tradingProfit)} ISK`}
          color={tradingProfit >= 0 ? "text-eve-profit" : "text-eve-error"}
        />
      </div>

      {/* Recent Activity */}
      <div className="grid grid-cols-2 gap-3">
        <StatCard label={t("charRecentBuys")} value={`${formatIsk(totalBought)} ISK`} subvalue={`${data.transactions?.filter((t) => t.is_buy).length ?? 0} ${t("charTxns")}`} />
        <StatCard label={t("charRecentSales")} value={`${formatIsk(totalSold)} ISK`} subvalue={`${data.transactions?.filter((t) => !t.is_buy).length ?? 0} ${t("charTxns")}`} />
      </div>
    </div>
  );
}

interface RiskTabProps {
  characterId: number;
  data: CharacterInfo;
  formatIsk: (v: number) => string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function RiskTab({ characterId, data, formatIsk, t }: RiskTabProps) {
  const risk = data.risk;

  if (!risk) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-eve-dim text-xs space-y-2">
        <div>{t("charRiskNoData")}</div>
        <div className="text-[10px] max-w-md text-center">
          {t("charRiskNoDataHint")}
        </div>
      </div>
    );
  }

  const riskLevelLabel =
    risk.risk_level === "safe"
      ? t("riskLevelSafe")
      : risk.risk_level === "balanced"
      ? t("riskLevelBalanced")
      : t("riskLevelHigh");

  const riskScore = Math.max(0, Math.min(100, risk.risk_score || 0));

  let riskColor = "bg-emerald-500";
  if (riskScore > 70) riskColor = "bg-red-500";
  else if (riskScore > 30) riskColor = "bg-amber-500";

  const typicalLoss = Math.max(0, risk.typical_daily_pnl || 0);
  const var99 = Math.max(0, risk.var_99 || 0);
  const es99 = Math.max(0, risk.es_99 || 0);
  const worst = Math.max(0, risk.worst_day_loss || 0);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-4 p-4 bg-eve-panel border border-eve-border rounded-sm">
        <img
          src={`https://images.evetech.net/characters/${characterId}/portrait?size=64`}
          alt=""
          className="w-12 h-12 rounded-sm"
        />
        <div className="flex-1">
          <div className="text-[10px] uppercase tracking-wider text-eve-dim mb-1">
            {t("charRiskTitle")}
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-lg font-bold text-eve-text">
              {riskLevelLabel}
            </div>
            <div className="text-xs text-eve-dim">
              {t("charRiskScoreLabel", { score: Math.round(riskScore) })}
            </div>
          </div>
          <div className="mt-2 h-2 w-full bg-eve-dark rounded-full overflow-hidden">
            <div
              className={`h-full ${riskColor}`}
              style={{ width: `${riskScore}%` }}
            />
          </div>
        </div>
      </div>

      {/* Worst-case loss + daily behaviour */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <StatCard
          label={t("charRiskWorstDay")}
          value={`-${formatIsk(worst)} ISK`}
          subvalue={t("charRiskWorstDayHint", { days: risk.sample_days })}
          color="text-eve-error"
        />
        <StatCard
          label={t("charRiskVar99")}
          value={`-${formatIsk(var99)} ISK`}
          subvalue={t("charRiskVar99Hint")}
          color="text-eve-warning"
        />
        <StatCard
          label={t("charRiskEs99")}
          value={`-${formatIsk(es99)} ISK`}
          subvalue={t("charRiskEs99Hint")}
          color="text-eve-warning"
        />
      </div>

      {/* Narrative explanation */}
      <div className="bg-eve-panel border border-eve-border rounded-sm p-3 text-xs text-eve-text space-y-1">
        <div>
          {t("charRiskSentenceLoss", {
            var: formatIsk(var99),
            days: risk.window_days,
          })}
        </div>
        <div>
          {t("charRiskSentenceTail", {
            es: formatIsk(es99),
          })}
        </div>
        <div className="text-eve-dim text-[11px]">
          {t("charRiskSentenceTypical", {
            typical: formatIsk(typicalLoss),
          })}
        </div>
      </div>

      {/* Capacity / suggestion */}
      <div className="bg-eve-panel border border-eve-border rounded-sm p-3 text-xs text-eve-text">
        {risk.capacity_multiplier > 1.05 ? (
          <div>
            {t("charRiskCapacityUp", {
              mult: risk.capacity_multiplier.toFixed(1),
            })}
          </div>
        ) : (
          <div>{t("charRiskCapacityMaxed")}</div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subvalue,
  color = "text-eve-text",
  large = false,
}: {
  label: string;
  value: string;
  subvalue?: string;
  color?: string;
  large?: boolean;
}) {
  return (
    <div className="bg-eve-panel border border-eve-border rounded-sm p-3">
      <div className="text-[10px] text-eve-dim uppercase tracking-wider mb-1">{label}</div>
      <div className={`${large ? "text-xl" : "text-lg"} font-bold ${color}`}>{value}</div>
      {subvalue && <div className="text-xs text-eve-dim">{subvalue}</div>}
    </div>
  );
}

interface OrdersTabProps {
  orders: CharacterOrder[];
  formatIsk: (v: number) => string;
  formatDate: (d: string) => string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function OrdersTab({ orders, formatIsk, formatDate, t }: OrdersTabProps) {
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");
  const filtered = orders.filter((o) => {
    if (filter === "buy") return o.is_buy_order;
    if (filter === "sell") return !o.is_buy_order;
    return true;
  });

  if (orders.length === 0) {
    return <div className="text-center text-eve-dim py-8">{t("charNoOrders")}</div>;
  }

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="flex gap-2">
        <FilterBtn active={filter === "all"} onClick={() => setFilter("all")} label={t("charAll")} count={orders.length} />
        <FilterBtn active={filter === "buy"} onClick={() => setFilter("buy")} label={t("charBuy")} count={orders.filter((o) => o.is_buy_order).length} color="text-eve-profit" />
        <FilterBtn active={filter === "sell"} onClick={() => setFilter("sell")} label={t("charSell")} count={orders.filter((o) => !o.is_buy_order).length} color="text-eve-error" />
      </div>

      {/* Table */}
      <div className="border border-eve-border rounded-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-eve-panel">
            <tr className="text-eve-dim">
              <th className="px-3 py-2 text-left">{t("charOrderType")}</th>
              <th className="px-3 py-2 text-left">{t("colItemName")}</th>
              <th className="px-3 py-2 text-right">{t("charPrice")}</th>
              <th className="px-3 py-2 text-right">{t("charVolume")}</th>
              <th className="px-3 py-2 text-right">{t("charTotal")}</th>
              <th className="px-3 py-2 text-left">{t("charLocation")}</th>
              <th className="px-3 py-2 text-left">{t("charIssued")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((order) => (
              <tr key={order.order_id} className="border-t border-eve-border/50 hover:bg-eve-panel/50">
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    order.is_buy_order ? "bg-eve-profit/20 text-eve-profit" : "bg-eve-error/20 text-eve-error"
                  }`}>
                    {order.is_buy_order ? "BUY" : "SELL"}
                  </span>
                </td>
                <td className="px-3 py-2 text-eve-text font-medium">
                  <div className="flex items-center gap-2">
                    <img
                      src={`https://images.evetech.net/types/${order.type_id}/icon?size=32`}
                      alt=""
                      className="w-5 h-5"
                    />
                    {order.type_name || `Type #${order.type_id}`}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-eve-accent">{formatIsk(order.price)}</td>
                <td className="px-3 py-2 text-right text-eve-dim">
                  {order.volume_remain.toLocaleString()}/{order.volume_total.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-right text-eve-text">{formatIsk(order.price * order.volume_remain)}</td>
                <td className="px-3 py-2 text-eve-dim text-[11px] max-w-[200px] truncate" title={order.location_name}>
                  {order.location_name || `Location #${order.location_id}`}
                </td>
                <td className="px-3 py-2 text-eve-dim text-[11px]">{formatDate(order.issued)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface HistoryTabProps {
  history: HistoricalOrder[];
  formatIsk: (v: number) => string;
  formatDate: (d: string) => string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function HistoryTab({ history, formatIsk, formatDate, t }: HistoryTabProps) {
  const [filter, setFilter] = useState<"all" | "fulfilled" | "cancelled" | "expired">("all");
  const sorted = [...history].sort((a, b) => new Date(b.issued).getTime() - new Date(a.issued).getTime());
  const filtered = sorted.filter((o) => filter === "all" || o.state === filter);

  if (history.length === 0) {
    return <div className="text-center text-eve-dim py-8">{t("charNoHistory")}</div>;
  }

  const stateColors: Record<string, string> = {
    fulfilled: "bg-eve-profit/20 text-eve-profit",
    cancelled: "bg-eve-warning/20 text-eve-warning",
    expired: "bg-eve-dim/20 text-eve-dim",
  };

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        <FilterBtn active={filter === "all"} onClick={() => setFilter("all")} label={t("charAll")} count={history.length} />
        <FilterBtn active={filter === "fulfilled"} onClick={() => setFilter("fulfilled")} label={t("charFulfilled")} count={history.filter((o) => o.state === "fulfilled").length} color="text-eve-profit" />
        <FilterBtn active={filter === "cancelled"} onClick={() => setFilter("cancelled")} label={t("charCancelled")} count={history.filter((o) => o.state === "cancelled").length} color="text-eve-warning" />
        <FilterBtn active={filter === "expired"} onClick={() => setFilter("expired")} label={t("charExpired")} count={history.filter((o) => o.state === "expired").length} color="text-eve-dim" />
      </div>

      {/* Table */}
      <div className="border border-eve-border rounded-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-eve-panel">
            <tr className="text-eve-dim">
              <th className="px-3 py-2 text-left">{t("charState")}</th>
              <th className="px-3 py-2 text-left">{t("charOrderType")}</th>
              <th className="px-3 py-2 text-left">{t("colItemName")}</th>
              <th className="px-3 py-2 text-right">{t("charPrice")}</th>
              <th className="px-3 py-2 text-right">{t("charFilled")}</th>
              <th className="px-3 py-2 text-left">{t("charLocation")}</th>
              <th className="px-3 py-2 text-left">{t("charIssued")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((order) => (
              <tr key={order.order_id} className="border-t border-eve-border/50 hover:bg-eve-panel/50">
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${stateColors[order.state] || ""}`}>
                    {order.state}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <span className={`text-[10px] font-medium ${order.is_buy_order ? "text-eve-profit" : "text-eve-error"}`}>
                    {order.is_buy_order ? "BUY" : "SELL"}
                  </span>
                </td>
                <td className="px-3 py-2 text-eve-text">
                  <div className="flex items-center gap-2">
                    <img
                      src={`https://images.evetech.net/types/${order.type_id}/icon?size=32`}
                      alt=""
                      className="w-5 h-5"
                    />
                    {order.type_name || `Type #${order.type_id}`}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-eve-accent">{formatIsk(order.price)}</td>
                <td className="px-3 py-2 text-right text-eve-dim">
                  {(order.volume_total - order.volume_remain).toLocaleString()}/{order.volume_total.toLocaleString()}
                </td>
                <td className="px-3 py-2 text-eve-dim text-[11px] max-w-[180px] truncate" title={order.location_name}>
                  {order.location_name || `#${order.location_id}`}
                </td>
                <td className="px-3 py-2 text-eve-dim text-[11px]">{formatDate(order.issued)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > 100 && (
        <div className="text-center text-eve-dim text-xs">{t("andMore", { count: filtered.length - 100 })}</div>
      )}
    </div>
  );
}

interface TransactionsTabProps {
  transactions: WalletTransaction[];
  formatIsk: (v: number) => string;
  formatDate: (d: string) => string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}

function TransactionsTab({ transactions, formatIsk, formatDate, t }: TransactionsTabProps) {
  const [filter, setFilter] = useState<"all" | "buy" | "sell">("all");
  const sorted = [...transactions].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const filtered = sorted.filter((tx) => {
    if (filter === "buy") return tx.is_buy;
    if (filter === "sell") return !tx.is_buy;
    return true;
  });

  if (transactions.length === 0) {
    return <div className="text-center text-eve-dim py-8">{t("charNoTransactions")}</div>;
  }

  return (
    <div className="space-y-3">
      {/* Filter */}
      <div className="flex gap-2">
        <FilterBtn active={filter === "all"} onClick={() => setFilter("all")} label={t("charAll")} count={transactions.length} />
        <FilterBtn active={filter === "buy"} onClick={() => setFilter("buy")} label={t("charBuy")} count={transactions.filter((t) => t.is_buy).length} color="text-eve-profit" />
        <FilterBtn active={filter === "sell"} onClick={() => setFilter("sell")} label={t("charSell")} count={transactions.filter((t) => !t.is_buy).length} color="text-eve-error" />
      </div>

      {/* Table */}
      <div className="border border-eve-border rounded-sm overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-eve-panel">
            <tr className="text-eve-dim">
              <th className="px-3 py-2 text-left">{t("charOrderType")}</th>
              <th className="px-3 py-2 text-left">{t("colItemName")}</th>
              <th className="px-3 py-2 text-right">{t("charUnitPrice")}</th>
              <th className="px-3 py-2 text-right">{t("charQty")}</th>
              <th className="px-3 py-2 text-right">{t("charTotal")}</th>
              <th className="px-3 py-2 text-left">{t("charLocation")}</th>
              <th className="px-3 py-2 text-left">{t("charDate")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 100).map((tx) => (
              <tr key={tx.transaction_id} className="border-t border-eve-border/50 hover:bg-eve-panel/50">
                <td className="px-3 py-2">
                  <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                    tx.is_buy ? "bg-eve-profit/20 text-eve-profit" : "bg-eve-error/20 text-eve-error"
                  }`}>
                    {tx.is_buy ? "BUY" : "SELL"}
                  </span>
                </td>
                <td className="px-3 py-2 text-eve-text">
                  <div className="flex items-center gap-2">
                    <img
                      src={`https://images.evetech.net/types/${tx.type_id}/icon?size=32`}
                      alt=""
                      className="w-5 h-5"
                    />
                    {tx.type_name || `Type #${tx.type_id}`}
                  </div>
                </td>
                <td className="px-3 py-2 text-right text-eve-accent">{formatIsk(tx.unit_price)}</td>
                <td className="px-3 py-2 text-right text-eve-dim">{tx.quantity.toLocaleString()}</td>
                <td className="px-3 py-2 text-right text-eve-text">{formatIsk(tx.unit_price * tx.quantity)}</td>
                <td className="px-3 py-2 text-eve-dim text-[11px] max-w-[180px] truncate" title={tx.location_name}>
                  {tx.location_name || `#${tx.location_id}`}
                </td>
                <td className="px-3 py-2 text-eve-dim text-[11px]">{formatDate(tx.date)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {filtered.length > 100 && (
        <div className="text-center text-eve-dim text-xs">{t("andMore", { count: filtered.length - 100 })}</div>
      )}
    </div>
  );
}

function FilterBtn({
  active,
  onClick,
  label,
  count,
  color = "text-eve-text",
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-xs rounded-sm border transition-colors ${
        active
          ? "bg-eve-accent/20 border-eve-accent text-eve-accent"
          : "bg-eve-panel border-eve-border text-eve-dim hover:text-eve-text hover:border-eve-accent/50"
      }`}
    >
      <span className={active ? "" : color}>{label}</span>
      <span className="ml-1 opacity-60">({count})</span>
    </button>
  );
}
