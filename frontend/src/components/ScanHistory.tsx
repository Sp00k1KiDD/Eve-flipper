import { useEffect, useState } from "react";
import { getScanHistory, deleteScanHistory, clearScanHistory, getScanHistoryResults } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatISK } from "@/lib/format";
import { useConfirmDialog } from "./ConfirmDialog";
import type { ScanRecord, FlipResult, ContractResult, StationTrade } from "@/lib/types";

interface ScanHistoryProps {
  onLoadResults?: (tab: string, results: unknown[], params: Record<string, unknown>) => void;
}

export function ScanHistory({ onLoadResults }: ScanHistoryProps) {
  const { t } = useI18n();
  const { confirm, prompt, DialogComponent } = useConfirmDialog();
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [viewingResults, setViewingResults] = useState<{
    scan: ScanRecord;
    results: FlipResult[] | ContractResult[] | StationTrade[];
  } | null>(null);
  const [loadingResults, setLoadingResults] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const loadHistory = async () => {
    try {
      const data = await getScanHistory(100);
      setHistory(data);
    } catch (e) {
      console.error("Failed to load history:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  const handleDelete = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = await confirm({
      title: t("historyDelete"),
      message: t("confirmDeleteScan"),
      confirmText: t("dialogDelete"),
      cancelText: t("dialogCancel"),
      variant: "danger",
    });
    if (!confirmed) return;
    try {
      await deleteScanHistory(id);
      setHistory((h) => h.filter((r) => r.id !== id));
      if (selectedId === id) setSelectedId(null);
      if (viewingResults?.scan.id === id) setViewingResults(null);
    } catch (e) {
      console.error("Delete failed:", e);
    }
  };

  const handleClearOld = async () => {
    const days = await prompt({
      title: t("clearOld"),
      message: t("clearOlderThanDays"),
      confirmText: t("dialogConfirm"),
      cancelText: t("dialogCancel"),
      inputType: "number",
      inputDefaultValue: "7",
      inputPlaceholder: "7",
    });
    if (!days) return;
    const d = parseInt(days, 10);
    if (isNaN(d) || d < 1) return;
    try {
      const result = await clearScanHistory(d);
      setStatusMessage(t("clearedScans", { count: result.deleted }));
      setTimeout(() => setStatusMessage(null), 3000);
      loadHistory();
    } catch (e) {
      console.error("Clear failed:", e);
    }
  };

  const handleViewResults = async (record: ScanRecord) => {
    setLoadingResults(true);
    try {
      const data = await getScanHistoryResults(record.id);
      setViewingResults({
        scan: data.scan,
        results: data.results as FlipResult[] | ContractResult[] | StationTrade[],
      });
    } catch (e) {
      console.error("Failed to load results:", e);
      alert(t("failedToLoadResults"));
    } finally {
      setLoadingResults(false);
    }
  };

  const handleLoadToTab = () => {
    if (!viewingResults || !onLoadResults) return;
    onLoadResults(viewingResults.scan.tab, viewingResults.results, viewingResults.scan.params);
    setViewingResults(null);
  };

  const getTabIcon = (tab: string) => {
    switch (tab) {
      case "radius": return "🔄";
      case "region": return "🌍";
      case "contracts": return "📜";
      case "station": return "🏪";
      case "routes": return "🛤️";
      default: return "📊";
    }
  };

  const getTabLabel = (tab: string) => {
    switch (tab) {
      case "radius": return t("radiusScan");
      case "region": return t("regionArbitrage");
      case "contracts": return t("historyContracts");
      case "station": return t("historyStationTrading");
      case "routes": return t("historyRouteBuilder");
      default: return tab;
    }
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (days === 1) {
      return t("yesterday") + " " + date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } else if (days < 7) {
      return `${days}d ago`;
    }
    return date.toLocaleDateString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-eve-dim">
        {t("loading")}...
      </div>
    );
  }

  // Results viewer modal
  if (viewingResults) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between p-4 border-b border-eve-border">
          <div>
            <h2 className="text-lg font-medium text-eve-text">
              {getTabIcon(viewingResults.scan.tab)} {getTabLabel(viewingResults.scan.tab)}
            </h2>
            <p className="text-sm text-eve-dim">
              {viewingResults.scan.system} — {formatDate(viewingResults.scan.timestamp)}
            </p>
          </div>
          <div className="flex gap-2">
            {onLoadResults && (
              <button
                onClick={handleLoadToTab}
                className="px-3 py-1.5 text-sm bg-eve-accent text-black rounded hover:bg-eve-accent/80"
              >
                {t("loadToTab")}
              </button>
            )}
            <button
              onClick={() => setViewingResults(null)}
              className="px-3 py-1.5 text-sm bg-eve-panel border border-eve-border rounded hover:bg-eve-border/50"
            >
              {t("historyBack")}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-auto p-4">
          <div className="grid grid-cols-4 gap-4 mb-4">
            <div className="bg-eve-panel p-3 rounded border border-eve-border">
              <div className="text-xs text-eve-dim uppercase">{t("historyResults")}</div>
              <div className="text-xl font-mono text-eve-text">{viewingResults.scan.count}</div>
            </div>
            <div className="bg-eve-panel p-3 rounded border border-eve-border">
              <div className="text-xs text-eve-dim uppercase">{t("historyTopProfit")}</div>
              <div className="text-xl font-mono text-eve-success">{formatISK(viewingResults.scan.top_profit)}</div>
            </div>
            <div className="bg-eve-panel p-3 rounded border border-eve-border">
              <div className="text-xs text-eve-dim uppercase">{t("historyTotalProfit")}</div>
              <div className="text-xl font-mono text-eve-success">{formatISK(viewingResults.scan.total_profit)}</div>
            </div>
            <div className="bg-eve-panel p-3 rounded border border-eve-border">
              <div className="text-xs text-eve-dim uppercase">{t("historyDuration")}</div>
              <div className="text-xl font-mono text-eve-text">{formatDuration(viewingResults.scan.duration_ms)}</div>
            </div>
          </div>

          {/* Params */}
          {viewingResults.scan.params && Object.keys(viewingResults.scan.params).length > 0 && (
            <details className="mb-4">
              <summary className="cursor-pointer text-sm text-eve-dim hover:text-eve-text">
                {t("scanParameters")}
              </summary>
              <pre className="mt-2 p-3 bg-eve-bg rounded text-xs text-eve-dim overflow-auto">
                {JSON.stringify(viewingResults.scan.params, null, 2)}
              </pre>
            </details>
          )}

          {/* Results preview */}
          <div className="text-sm text-eve-dim mb-2">
            {t("resultsPreview")} ({(viewingResults.results || []).length} {t("historyItems")})
          </div>
          <div className="overflow-auto max-h-96 border border-eve-border rounded">
            <table className="w-full text-xs">
              <thead className="bg-eve-panel sticky top-0">
                <tr>
                  <th className="text-left p-2 border-b border-eve-border">{t("colItemName")}</th>
                  <th className="text-right p-2 border-b border-eve-border">{t("historyProfit")}</th>
                  <th className="text-right p-2 border-b border-eve-border">{t("historyMargin")}</th>
                </tr>
              </thead>
              <tbody>
                {(viewingResults.results || []).slice(0, 50).map((r, i) => {
                  if (!r) return null;
                  const name = (r as FlipResult).TypeName || (r as ContractResult).Title || (r as StationTrade).TypeName || "Unknown";
                  const profit = (r as FlipResult).TotalProfit ?? (r as ContractResult).Profit ?? (r as StationTrade).TotalProfit ?? 0;
                  const margin = (r as FlipResult).MarginPercent ?? (r as ContractResult).MarginPercent ?? (r as StationTrade).MarginPercent ?? 0;
                  return (
                    <tr key={i} className="hover:bg-eve-accent/5">
                      <td className="p-2 border-b border-eve-border/30">{name}</td>
                      <td className="p-2 border-b border-eve-border/30 text-right text-eve-success font-mono">
                        {formatISK(profit)}
                      </td>
                      <td className="p-2 border-b border-eve-border/30 text-right font-mono">
                        {margin.toFixed(1)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {(viewingResults.results || []).length > 50 && (
              <div className="p-2 text-center text-xs text-eve-dim bg-eve-panel">
                ... {t("andMore", { count: (viewingResults.results || []).length - 50 })}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {DialogComponent}
      
      {/* Status message */}
      {statusMessage && (
        <div className="absolute top-4 right-4 px-4 py-2 bg-eve-accent/20 border border-eve-accent/30 rounded-sm text-sm text-eve-accent z-50">
          {statusMessage}
        </div>
      )}
      
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-eve-border">
        <h2 className="text-lg font-medium text-eve-text">{t("scanHistory")}</h2>
        <div className="flex gap-2">
          <button
            onClick={loadHistory}
            className="px-3 py-1.5 text-sm bg-eve-panel border border-eve-border rounded hover:bg-eve-border/50"
          >
            {t("historyRefresh")}
          </button>
          <button
            onClick={handleClearOld}
            className="px-3 py-1.5 text-sm bg-eve-panel border border-eve-border rounded hover:bg-eve-error/20 text-eve-error"
          >
            {t("clearOld")}
          </button>
        </div>
      </div>

      {/* History list */}
      {history.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-eve-dim">
          {t("noScanHistory")}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-eve-panel sticky top-0">
              <tr>
                <th className="text-left p-3 border-b border-eve-border">{t("historyType")}</th>
                <th className="text-left p-3 border-b border-eve-border">{t("historyLocation")}</th>
                <th className="text-right p-3 border-b border-eve-border">{t("historyResults")}</th>
                <th className="text-right p-3 border-b border-eve-border">{t("historyTopProfit")}</th>
                <th className="text-right p-3 border-b border-eve-border">{t("historyTotalProfit")}</th>
                <th className="text-right p-3 border-b border-eve-border">{t("historyDuration")}</th>
                <th className="text-left p-3 border-b border-eve-border">{t("historyTime")}</th>
                <th className="p-3 border-b border-eve-border w-24"></th>
              </tr>
            </thead>
            <tbody>
              {history.map((record) => (
                <tr
                  key={record.id}
                  className={`hover:bg-eve-accent/5 cursor-pointer ${
                    selectedId === record.id ? "bg-eve-accent/10" : ""
                  }`}
                  onClick={() => setSelectedId(selectedId === record.id ? null : record.id)}
                >
                  <td className="p-3 border-b border-eve-border/30">
                    <span className="mr-2">{getTabIcon(record.tab)}</span>
                    {getTabLabel(record.tab)}
                  </td>
                  <td className="p-3 border-b border-eve-border/30 text-eve-text">
                    {record.system}
                  </td>
                  <td className="p-3 border-b border-eve-border/30 text-right font-mono">
                    {record.count}
                  </td>
                  <td className="p-3 border-b border-eve-border/30 text-right font-mono text-eve-success">
                    {formatISK(record.top_profit)}
                  </td>
                  <td className="p-3 border-b border-eve-border/30 text-right font-mono text-eve-success">
                    {formatISK(record.total_profit || 0)}
                  </td>
                  <td className="p-3 border-b border-eve-border/30 text-right font-mono text-eve-dim">
                    {formatDuration(record.duration_ms || 0)}
                  </td>
                  <td className="p-3 border-b border-eve-border/30 text-eve-dim">
                    {formatDate(record.timestamp)}
                  </td>
                  <td className="p-3 border-b border-eve-border/30">
                    <div className="flex gap-1 justify-end">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleViewResults(record);
                        }}
                        disabled={loadingResults}
                        className="px-2 py-1 text-xs bg-eve-accent/20 text-eve-accent rounded hover:bg-eve-accent/30"
                        title={t("viewResults")}
                      >
                        {loadingResults ? "..." : t("historyView")}
                      </button>
                      <button
                        onClick={(e) => handleDelete(record.id, e)}
                        className="px-2 py-1 text-xs bg-eve-error/20 text-eve-error rounded hover:bg-eve-error/30"
                        title={t("historyDelete")}
                      >
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
