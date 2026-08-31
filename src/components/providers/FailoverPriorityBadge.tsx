import { cn } from "@/lib/utils";
import { useTranslation } from "react-i18next";

interface FailoverPriorityBadgeProps {
  priority: number; // 1, 2, 3, ...
  className?: string;
}

/**
 * Insignia de prioridad de failover
 * Muestra el orden de prioridad del proveedor en la cola de failover
 */
export function FailoverPriorityBadge({
  priority,
  className,
}: FailoverPriorityBadgeProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold",
        "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        className,
      )}
      title={t("failover.priority.tooltip", {
        priority,
        defaultValue: `Prioridad de failover ${priority}`,
      })}
    >
      P{priority}
    </div>
  );
}
