import { useTranslation } from "react-i18next";
import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { useUsageSummaryByApp } from "@/lib/query/usage";
import { cn } from "@/lib/utils";
import {
  Activity,
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  Info,
  Loader2,
  Sparkles,
  Zap,
} from "lucide-react";
import {
  fmtUsd,
  formatTokensShort,
  parseFiniteNumber,
} from "./format";
import {
  CACHE_INCLUSIVE_APP_TYPES,
  type AppType,
  type UsageRangeSelection,
  type UsageSummary,
  type UsageSummaryByApp,
} from "@/types/usage";

interface UsageHeroProps {
  range: UsageRangeSelection;
  appType?: string;
  refreshIntervalMs: number;
}

interface TitleTheme {
  /** Foreground color for the icon glyph (text-* class). */
  accent: string;
  /** Background tint for the icon square (bg-* class). */
  iconBg: string;
}

const TITLE_THEMES: Record<AppType | "all", TitleTheme> = {
  all: { accent: "text-primary", iconBg: "bg-primary/10" },
  claude: {
    accent: "text-amber-600 dark:text-amber-400",
    iconBg: "bg-amber-500/10",
  },
  codex: {
    accent: "text-emerald-600 dark:text-emerald-400",
    iconBg: "bg-emerald-500/10",
  },
  gemini: {
    accent: "text-sky-600 dark:text-sky-400",
    iconBg: "bg-sky-500/10",
  },
};

/**
 * Combinar resúmenes por app en un solo resumen consolidado.
 *
 * Las filas por app del backend ya usan semántica de entrada fresca (proveedores
 * inclusivos de caché fueron normalizados en SQL), así que suma simple es correcta.
 * `cacheHitRate` y `successRate` deben re-derivarse de los conteos sumados
 * en lugar de promediar entre filas.
 */
function aggregateSummaries(items: UsageSummary[]): UsageSummary {
  let totalRequests = 0;
  let successCount = 0;
  let totalCostNum = 0;
  let input = 0;
  let output = 0;
  let cacheCreation = 0;
  let cacheRead = 0;

  for (const s of items) {
    totalRequests += s.totalRequests;
    successCount += Math.round((s.totalRequests * s.successRate) / 100);
    totalCostNum += parseFiniteNumber(s.totalCost) ?? 0;
    input += s.totalInputTokens;
    output += s.totalOutputTokens;
    cacheCreation += s.totalCacheCreationTokens;
    cacheRead += s.totalCacheReadTokens;
  }

  const cacheableInput = input + cacheCreation + cacheRead;
  return {
    totalRequests,
    totalCost: totalCostNum.toFixed(6),
    totalInputTokens: input,
    totalOutputTokens: output,
    totalCacheCreationTokens: cacheCreation,
    totalCacheReadTokens: cacheRead,
    successRate: totalRequests > 0 ? (successCount / totalRequests) * 100 : 0,
    realTotalTokens: input + output + cacheCreation + cacheRead,
    cacheHitRate: cacheableInput > 0 ? cacheRead / cacheableInput : 0,
  };
}

function pickSummary(
  apps: UsageSummaryByApp[],
  appType: string | undefined,
): UsageSummary | undefined {
  if (apps.length === 0) return undefined;
  if (appType) {
    return apps.find((a) => a.appType === appType)?.summary;
  }
  return aggregateSummaries(apps.map((a) => a.summary));
}

type CacheWriteState = "ok" | "partial" | "na";

/**
 * Los protocolos estilo Anthropic reportan creación de caché; protocolos estilo
 * OpenAI (Codex/Gemini) no lo hacen — así que una mezcla muestra el número con
 * advertencia, todo-OpenAI muestra N/A. `appTypes` es el conjunto que realmente
 * contribuye al resumen mostrado (una sola app, o cada app que participó en "all").
 */
function deriveCacheWriteState(appTypes: string[]): CacheWriteState {
  if (appTypes.length === 0) return "ok";
  const inclusive = appTypes.filter((t) =>
    CACHE_INCLUSIVE_APP_TYPES.has(t),
  ).length;
  if (inclusive === appTypes.length) return "na";
  if (inclusive === 0) return "ok";
  return "partial";
}

export function UsageHero({
  range,
  appType,
  refreshIntervalMs,
}: UsageHeroProps) {
  const { t } = useTranslation();

  const { data, isLoading } = useUsageSummaryByApp(range, {
    refetchInterval: refreshIntervalMs > 0 ? refreshIntervalMs : false,
  });

  // Sin filtrado del lado del cliente: los totales de Hero deben coincidir con Trend/Logs/Stats
  // abajo, que todos pasan por el conjunto completo de app_types del backend. La lista
  // KNOWN_APP_TYPES solo gobierna qué botones de filtro aparecen, no qué
  // filas participan en el agregado "all".
  const allApps = data ?? [];
  const summary = pickSummary(allApps, appType);

  const titleTheme =
    TITLE_THEMES[(appType ?? "all") as keyof typeof TITLE_THEMES] ??
    TITLE_THEMES.all;
  const appLabel =
    appType && appType in TITLE_THEMES ? t(`usage.appFilter.${appType}`) : null;

  const cacheWriteState = deriveCacheWriteState(
    appType ? [appType] : allApps.map((a) => a.appType),
  );

  const input = summary?.totalInputTokens ?? 0;
  const output = summary?.totalOutputTokens ?? 0;
  const cacheWrite = summary?.totalCacheCreationTokens ?? 0;
  const cacheRead = summary?.totalCacheReadTokens ?? 0;
  const realTotal = summary?.realTotalTokens ?? 0;
  const hitRate = summary?.cacheHitRate ?? 0;
  const totalCost = parseFiniteNumber(summary?.totalCost);
  const requests = summary?.totalRequests ?? 0;

  const cacheWriteDisplay = {
    value:
      cacheWriteState === "na" ? "N/A" : formatTokensShort(cacheWrite),
    muted: cacheWriteState === "na",
    tooltip:
      cacheWriteState === "na"
        ? t(
            "usage.cacheWriteNotReported",
            "El protocolo OpenAI no distingue escritura de caché, solo reporta aciertos de caché",
          )
        : cacheWriteState === "partial"
          ? t(
              "usage.cacheWritePartial",
              "Algunos protocolos (como OpenAI) no reportan escritura de caché, el valor puede ser bajo",
            )
          : undefined,
  };

  if (isLoading) {
    return (
      <Card className="border border-border/50 bg-card/40 backdrop-blur-sm">
        <CardContent className="flex items-center justify-center min-h-[200px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground/50" />
        </CardContent>
      </Card>
    );
  }

  const hitPercent = Math.max(0, Math.min(100, hitRate * 100));
  const hitPercentLabel = hitPercent.toFixed(hitPercent >= 99.95 ? 0 : 1);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Card className="relative overflow-hidden border border-border/50 bg-gradient-to-br from-primary/5 via-card/50 to-background/50 backdrop-blur-xl shadow-sm">
        <CardContent className="p-6 md:p-8">
          {/* Encabezado: título + costo */}
          <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
            <div className="flex items-center gap-2">
              <div className={cn("p-2 rounded-lg", titleTheme.iconBg)}>
                <Zap className={cn("h-4 w-4", titleTheme.accent)} />
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                {appLabel && (
                  <>
                    <span className={cn("font-semibold", titleTheme.accent)}>
                      {appLabel}
                    </span>
                    <span className="mx-1.5 text-muted-foreground/40">·</span>
                  </>
                )}
                {t("usage.realTotal", "Tokens consumidos reales")}
              </span>
            </div>
            <div className="flex items-center gap-4 text-right">
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">
                  {t("usage.totalRequests")}
                </span>
                <span className="text-sm font-semibold flex items-center gap-1 justify-end">
                  <Activity className="h-3.5 w-3.5 text-blue-500" />
                  {requests.toLocaleString()}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-xs text-muted-foreground">
                  {t("usage.totalCost")}
                </span>
                <span className="text-sm font-semibold text-green-500">
                  {totalCost == null ? "--" : fmtUsd(totalCost, 4)}
                </span>
              </div>
            </div>
          </div>

          {/* Número principal */}
          <div className="flex flex-col items-start mb-6">
            <div
              className="text-4xl md:text-5xl font-bold tracking-tight tabular-nums leading-tight"
              title={realTotal.toLocaleString()}
            >
              {realTotal.toLocaleString()}
            </div>
            <div className="text-sm text-muted-foreground mt-1">
              ≈ {formatTokensShort(realTotal, 2)}{" "}
              {t("usage.tokensSuffix", "tokens")}
            </div>
          </div>

          {/* Fila de desglose: 4 mini stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
            <MiniStat
              icon={<ArrowDownToLine className="h-3.5 w-3.5" />}
              label={t("usage.freshInput", "Nueva entrada")}
              value={formatTokensShort(input)}
              accent="text-blue-500"
            />
            <MiniStat
              icon={<ArrowUpFromLine className="h-3.5 w-3.5" />}
              label={t("usage.output")}
              value={formatTokensShort(output)}
              accent="text-purple-500"
            />
            <MiniStat
              icon={<Database className="h-3.5 w-3.5" />}
              label={t("usage.cacheWrite", "Escritura de caché")}
              value={cacheWriteDisplay.value}
              accent="text-amber-500"
              muted={cacheWriteDisplay.muted}
              tooltip={cacheWriteDisplay.tooltip}
            />
            <MiniStat
              icon={<Sparkles className="h-3.5 w-3.5" />}
              label={t("usage.cacheRead", "Acierto de caché")}
              value={formatTokensShort(cacheRead)}
              accent="text-emerald-500"
            />
          </div>

          {/* Barra de progreso de tasa de aciertos */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">
                {t("usage.cacheHitRate", "Tasa de acierto de caché")}
              </span>
              <span className="font-semibold text-emerald-500 tabular-nums">
                {hitPercentLabel}%
              </span>
            </div>
            <div className="relative h-2 rounded-full bg-muted/50 overflow-hidden">
              <motion.div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-emerald-500/80 to-emerald-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: `${hitPercent}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

interface MiniStatProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent: string;
  /** Tooltip opcional al pasar el mouse — usado para señalar advertencias a nivel de protocolo. */
  tooltip?: string;
  /** Desenfatizar visualmente el valor (ej. para casos "N/A"). */
  muted?: boolean;
}

function MiniStat({
  icon,
  label,
  value,
  accent,
  tooltip,
  muted,
}: MiniStatProps) {
  return (
    <div
      className="flex flex-col gap-1 rounded-lg border border-border/40 bg-background/40 px-3 py-2.5"
      title={tooltip}
    >
      <div
        className={`flex items-center gap-1.5 text-xs text-muted-foreground ${accent}`}
      >
        {icon}
        <span className="text-foreground/70">{label}</span>
        {tooltip && (
          <Info className="h-3 w-3 text-muted-foreground/60 shrink-0" />
        )}
      </div>
      <div
        className={cn(
          "text-base font-semibold tabular-nums",
          muted && "text-muted-foreground/70",
        )}
      >
        {value}
      </div>
    </div>
  );
}
