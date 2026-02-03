import { useCallback, useEffect, useState, createContext, useContext, type ReactNode } from "react";

export type ToastType = "info" | "success" | "error" | "warning";

export interface ToastMessage {
  id: number;
  text: string;
  type: ToastType;
}

let toastId = 0;

export function useToast() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((text: string, type: ToastType = "info", duration = 4000) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return { toasts, addToast, removeToast };
}

// Context for global toast access
interface ToastContextType {
  addToast: (text: string, type?: ToastType, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const { toasts, addToast } = useToast();

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <ToastContainer toasts={toasts} />
    </ToastContext.Provider>
  );
}

export function useGlobalToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useGlobalToast must be used within a ToastProvider");
  }
  return context;
}

export function ToastContainer({ toasts }: { toasts: ToastMessage[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} text={toast.text} type={toast.type} />
      ))}
    </div>
  );
}

function ToastItem({ text, type }: { text: string; type: ToastType }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const typeStyles: Record<ToastType, string> = {
    info: "border-eve-accent/50 bg-eve-panel",
    success: "border-green-500/50 bg-green-900/20",
    error: "border-eve-error/50 bg-red-900/20",
    warning: "border-yellow-500/50 bg-yellow-900/20",
  };

  const iconMap: Record<ToastType, string> = {
    info: "ℹ️",
    success: "✓",
    error: "✕",
    warning: "⚠️",
  };

  return (
    <div
      className={`flex items-center gap-2 px-4 py-3 border rounded-sm shadow-eve-glow text-xs text-eve-text pointer-events-auto
        transition-all duration-300 ${typeStyles[type]} ${visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"}`}
    >
      <span className={type === "success" ? "text-green-400" : type === "error" ? "text-eve-error" : ""}>
        {iconMap[type]}
      </span>
      <span>{text}</span>
    </div>
  );
}
