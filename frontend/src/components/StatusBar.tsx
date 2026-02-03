import { useEffect, useRef, useState } from "react";
import { getStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import type { AppStatus } from "@/lib/types";

export function StatusBar() {
  const { t } = useI18n();
  const [status, setStatus] = useState<AppStatus | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    
    const poll = async () => {
      try {
        const data = await getStatus();
        if (mountedRef.current) {
          setStatus(data);
        }
      } catch {
        // Ignore errors during polling
      }
    };
    
    poll();
    const id = setInterval(poll, 5000);
    
    return () => {
      mountedRef.current = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex items-center gap-4 h-[34px] px-4 bg-eve-panel border border-eve-border rounded-sm">
      <StatusDot
        ok={status?.sde_loaded ?? false}
        loading={status === null}
        label={
          status?.sde_loaded
            ? `SDE: ${status.sde_systems} ${t("sdeSystems")}, ${status.sde_types} ${t("sdeTypes")}`
            : t("sdeLoading")
        }
      />
      <div className="w-px h-4 bg-eve-border" />
      <StatusDot
        ok={status?.esi_ok ?? false}
        loading={status === null}
        label={status?.esi_ok ? t("esiApi") : t("esiUnavailable")}
      />
    </div>
  );
}

function StatusDot({ ok, loading, label }: { ok: boolean; loading: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <div
        className={`w-2 h-2 rounded-full ${
          loading
            ? "bg-eve-accent animate-pulse"
            : ok
              ? "bg-eve-success"
              : "bg-eve-error"
        }`}
      />
      <span className={ok ? "text-eve-text" : "text-eve-dim"}>{label}</span>
    </div>
  );
}
