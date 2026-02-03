import { useState, useRef, useEffect, type ReactNode } from "react";

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  position?: "top" | "bottom" | "left" | "right";
  delay?: number;
  maxWidth?: string;
}

export function Tooltip({
  content,
  children,
  position = "top",
  delay = 300,
  maxWidth = "250px",
}: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const showTooltip = () => {
    timerRef.current = setTimeout(() => {
      setVisible(true);
    }, delay);
  };

  const hideTooltip = () => {
    clearTimeout(timerRef.current);
    setVisible(false);
  };

  useEffect(() => {
    if (visible && triggerRef.current && tooltipRef.current) {
      const triggerRect = triggerRef.current.getBoundingClientRect();
      const tooltipRect = tooltipRef.current.getBoundingClientRect();
      const padding = 8;

      let x = 0;
      let y = 0;

      switch (position) {
        case "top":
          x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
          y = triggerRect.top - tooltipRect.height - padding;
          break;
        case "bottom":
          x = triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
          y = triggerRect.bottom + padding;
          break;
        case "left":
          x = triggerRect.left - tooltipRect.width - padding;
          y = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
          break;
        case "right":
          x = triggerRect.right + padding;
          y = triggerRect.top + triggerRect.height / 2 - tooltipRect.height / 2;
          break;
      }

      // Keep tooltip within viewport
      const viewportPadding = 10;
      x = Math.max(viewportPadding, Math.min(x, window.innerWidth - tooltipRect.width - viewportPadding));
      y = Math.max(viewportPadding, Math.min(y, window.innerHeight - tooltipRect.height - viewportPadding));

      setCoords({ x, y });
    }
  }, [visible, position]);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  return (
    <>
      <div
        ref={triggerRef}
        onMouseEnter={showTooltip}
        onMouseLeave={hideTooltip}
        onFocus={showTooltip}
        onBlur={hideTooltip}
        className="inline-flex"
      >
        {children}
      </div>
      {visible && (
        <div
          ref={tooltipRef}
          className="fixed z-[200] px-3 py-2 bg-eve-dark border border-eve-border rounded-sm shadow-eve-glow-strong text-xs text-eve-text animate-in fade-in duration-150"
          style={{
            left: coords.x,
            top: coords.y,
            maxWidth,
          }}
        >
          {content}
        </div>
      )}
    </>
  );
}

// Info icon with tooltip for metrics
interface MetricTooltipProps {
  title: string;
  description: string;
  formula?: string;
  goodRange?: string;
  badRange?: string;
}

export function MetricTooltip({ title, description, formula, goodRange, badRange }: MetricTooltipProps) {
  return (
    <Tooltip
      position="top"
      maxWidth="300px"
      content={
        <div className="space-y-2">
          <div className="font-semibold text-eve-accent">{title}</div>
          <div className="text-eve-dim">{description}</div>
          {formula && (
            <div className="text-[10px] font-mono text-eve-dim/80 bg-eve-panel px-2 py-1 rounded">
              {formula}
            </div>
          )}
          {(goodRange || badRange) && (
            <div className="flex gap-3 text-[10px]">
              {goodRange && (
                <span className="text-green-400">✓ Good: {goodRange}</span>
              )}
              {badRange && (
                <span className="text-red-400">✕ Risk: {badRange}</span>
              )}
            </div>
          )}
        </div>
      }
    >
      <span className="ml-1 text-eve-dim/50 hover:text-eve-accent cursor-help transition-colors">ⓘ</span>
    </Tooltip>
  );
}
