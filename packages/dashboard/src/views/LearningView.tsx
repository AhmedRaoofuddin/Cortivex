import { useMemo, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Area,
  AreaChart,
  ReferenceLine,
} from 'recharts';
import {
  ArrowUpRight,
  ArrowDownRight,
  Shuffle,
  Replace,
  SkipForward,
  Plus,
  Thermometer,
  MessageSquare,
  TrendingUp,
  Zap,
  DollarSign,
  Clock,
  CheckCircle,
  Cpu,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { useCortivexStore } from '@/stores/cortivexStore';
import type { InsightAction, Suggestion } from '@/lib/types';
import { CATEGORY_COLORS } from '@/lib/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const insightIcons: Record<InsightAction, React.ComponentType<any>> = {
  reorder: Shuffle,
  substitute_model: Replace,
  skip_node: SkipForward,
  add_node: Plus,
  adjust_temperature: Thermometer,
  modify_prompt: MessageSquare,
};

const insightColors: Record<InsightAction, string> = {
  reorder: '#4F8EF7',
  substitute_model: '#7B6EF6',
  skip_node: '#E8A44A',
  add_node: '#3DD68C',
  adjust_temperature: '#E05C5C',
  modify_prompt: '#22d3ee',
};

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

const TOOLTIP_STYLE = {
  backgroundColor: '#12151E',
  border: '1px solid #1A1F2E',
  borderRadius: '8px',
  fontSize: '11px',
  color: '#CDD5E0',
};

const GRID_STROKE = '#1A1F2E';
const AXIS_TICK = { fontSize: 9, fill: '#5A6478', fontFamily: 'Space Mono' };

export function LearningView() {
  const { history, insights, suggestions, fetchInitialData } = useCortivexStore();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await fetchInitialData();
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchInitialData]);

  // Empty state — no data available
  if (history.length === 0 && insights.length === 0 && suggestions.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <div className="bg-canvas-card border border-canvas-border rounded-2xl p-8 text-center max-w-md shadow-xl">
          <div className="w-16 h-16 rounded-2xl bg-cortivex-cyan/10 flex items-center justify-center mx-auto mb-4">
            <TrendingUp size={28} className="text-cortivex-cyan" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary mb-2">
            No Learning Data Yet
          </h3>
          <p className="text-sm text-text-muted mb-6">
            Run some pipelines to start collecting execution history, insights, and optimization suggestions.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="mx-auto"
          >
            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
            {isRefreshing ? 'Refreshing...' : 'Refresh from API'}
          </Button>
        </div>
      </div>
    );
  }

  // Summary stats
  const stats = useMemo(() => {
    const totalRuns = history.length;
    const totalCost = history.reduce((s, r) => s + r.cost, 0);
    const totalTokens = history.reduce((s, r) => s + r.tokensUsed, 0);
    const successCount = history.filter((r) => r.success).length;
    const successRate = totalRuns > 0 ? (successCount / totalRuns) * 100 : 0;
    const avgDuration = totalRuns > 0
      ? history.reduce((s, r) => s + r.duration, 0) / totalRuns
      : 0;
    return { totalRuns, totalCost, totalTokens, successRate, avgDuration };
  }, [history]);

  // Cost over time (grouped by date)
  const costOverTime = useMemo(() => {
    const sorted = [...history].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const byDate: Record<string, { cost: number; runs: number; tokens: number }> = {};
    for (const record of sorted) {
      const dateKey = new Date(record.timestamp).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      });
      if (!byDate[dateKey]) byDate[dateKey] = { cost: 0, runs: 0, tokens: 0 };
      byDate[dateKey].cost += record.cost;
      byDate[dateKey].runs += 1;
      byDate[dateKey].tokens += record.tokensUsed;
    }
    return Object.entries(byDate).map(([date, data]) => ({
      date,
      cost: Number(data.cost.toFixed(2)),
      runs: data.runs,
      tokens: data.tokens,
    }));
  }, [history]);

  // Tokens per pipeline
  const tokensPerPipeline = useMemo(() => {
    const byPipeline: Record<string, { tokens: number; runs: number; cost: number }> = {};
    for (const record of history) {
      if (!byPipeline[record.pipelineName]) {
        byPipeline[record.pipelineName] = { tokens: 0, runs: 0, cost: 0 };
      }
      byPipeline[record.pipelineName].tokens += record.tokensUsed;
      byPipeline[record.pipelineName].runs += 1;
      byPipeline[record.pipelineName].cost += record.cost;
    }
    return Object.entries(byPipeline)
      .map(([name, data]) => ({
        name,
        tokens: data.tokens,
        runs: data.runs,
        avgCost: Number((data.cost / data.runs).toFixed(2)),
      }))
      .sort((a, b) => b.tokens - a.tokens);
  }, [history]);

  // Success rate over time (rolling 5-run window)
  const successRateData = useMemo(() => {
    const sorted = [...history].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const windowSize = 5;
    const data: { run: string; rate: number }[] = [];
    for (let i = windowSize - 1; i < sorted.length; i++) {
      const window = sorted.slice(i - windowSize + 1, i + 1);
      const successes = window.filter((r) => r.success).length;
      data.push({
        run: `#${sorted[i].runNumber}`,
        rate: Number(((successes / windowSize) * 100).toFixed(0)),
      });
    }
    return data;
  }, [history]);

  // First 10 / Last 10 comparison
  const first10 = useMemo(() => {
    const slice = history.slice(0, 10);
    return {
      successRate: (slice.filter((r) => r.success).length / slice.length) * 100,
      avgCost: slice.reduce((s, r) => s + r.cost, 0) / slice.length,
      avgDuration: slice.reduce((s, r) => s + r.duration, 0) / slice.length / 60,
    };
  }, [history]);

  const last10 = useMemo(() => {
    const slice = history.slice(-10);
    return {
      successRate: (slice.filter((r) => r.success).length / slice.length) * 100,
      avgCost: slice.reduce((s, r) => s + r.cost, 0) / slice.length,
      avgDuration: slice.reduce((s, r) => s + r.duration, 0) / slice.length / 60,
    };
  }, [history]);

  return (
    <div className="h-full overflow-y-auto p-6 space-y-6">
      {/* Tab navigation */}
      <Tabs defaultValue="overview">
        <div className="flex items-center justify-between">
          <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="insights">Insights & Learning</TabsTrigger>
          </TabsList>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isRefreshing}
            className="text-[10px] h-7 px-3"
          >
            <RefreshCw size={12} className={cn('mr-1', isRefreshing && 'animate-spin')} />
            {isRefreshing ? 'Refreshing...' : 'Refresh'}
          </Button>
        </div>

        {/* ============================================ */}
        {/* OVERVIEW TAB                                 */}
        {/* ============================================ */}
        <TabsContent value="overview" className="space-y-6">
          {/* Stat Cards Row */}
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              label="Total Runs"
              value={String(stats.totalRuns)}
              icon={<CheckCircle size={16} />}
              color="#4F8EF7"
              subtext={`${stats.successRate.toFixed(0)}% success rate`}
            />
            <StatCard
              label="Total Cost"
              value={`$${stats.totalCost.toFixed(2)}`}
              icon={<DollarSign size={16} />}
              color="#3DD68C"
              subtext={`$${(stats.totalCost / Math.max(stats.totalRuns, 1)).toFixed(2)} avg per run`}
            />
            <StatCard
              label="Total Tokens"
              value={formatNumber(stats.totalTokens)}
              icon={<Cpu size={16} />}
              color="#7B6EF6"
              subtext={`${formatNumber(stats.totalTokens / Math.max(stats.totalRuns, 1))} avg per run`}
            />
            <StatCard
              label="Avg Duration"
              value={formatDuration(stats.avgDuration)}
              icon={<Clock size={16} />}
              color="#E8A44A"
              subtext={`${stats.totalRuns} runs measured`}
            />
          </div>

          {/* Charts Row 1: Cost + Runs */}
          <div className="grid grid-cols-2 gap-4">
            <ChartPanel title="Cost Over Time" delay={0.05}>
              <ResponsiveContainer width="100%" height={220}>
                <AreaChart data={costOverTime}>
                  <defs>
                    <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#4F8EF7" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#4F8EF7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRID_STROKE} strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="date" tick={AXIS_TICK} stroke="transparent" />
                  <YAxis tick={AXIS_TICK} stroke="transparent" tickFormatter={(v) => `$${v}`} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`$${v.toFixed(2)}`, 'Cost']} />
                  <Area type="monotone" dataKey="cost" stroke="#4F8EF7" fill="url(#costGrad)" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: '#4F8EF7', stroke: '#050508', strokeWidth: 2 }} />
                </AreaChart>
              </ResponsiveContainer>
            </ChartPanel>

            <ChartPanel title="Runs Per Day" delay={0.1}>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={costOverTime}>
                  <CartesianGrid stroke={GRID_STROKE} strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="date" tick={AXIS_TICK} stroke="transparent" />
                  <YAxis tick={AXIS_TICK} stroke="transparent" allowDecimals={false} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="runs" name="Runs" fill="#7B6EF6" radius={[4, 4, 0, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </ChartPanel>
          </div>

          {/* Charts Row 2: Tokens + Success Rate */}
          <div className="grid grid-cols-2 gap-4">
            <ChartPanel title="Tokens Per Pipeline" delay={0.15}>
              <div className="space-y-3 mt-2">
                {tokensPerPipeline.map((item) => {
                  const maxTokens = tokensPerPipeline[0]?.tokens || 1;
                  const pct = (item.tokens / maxTokens) * 100;
                  return (
                    <div key={item.name}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-mono text-text-primary">{item.name}</span>
                        <span className="text-xs font-mono text-text-muted">{formatNumber(item.tokens)} tokens</span>
                      </div>
                      <div className="h-2 rounded-full bg-surface overflow-hidden">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.6, delay: 0.3 }}
                          className="h-full rounded-full"
                          style={{
                            background: 'linear-gradient(90deg, #7B6EF6, #4F8EF7)',
                            boxShadow: '0 0 8px rgba(79,142,247,0.3)',
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[10px] font-mono text-text-dim">{item.runs} runs</span>
                        <span className="text-[10px] font-mono text-text-dim">${item.avgCost}/run avg</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </ChartPanel>

            <ChartPanel title="Success Rate (Rolling 5-Run)" delay={0.2}>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={successRateData}>
                  <CartesianGrid stroke={GRID_STROKE} strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="run" tick={AXIS_TICK} stroke="transparent" interval={4} />
                  <YAxis tick={AXIS_TICK} stroke="transparent" domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v}%`, 'Success Rate']} />
                  <ReferenceLine y={first10.successRate} stroke="#353D4F" strokeDasharray="4 4" />
                  <Line type="monotone" dataKey="rate" name="Success Rate" stroke="#3DD68C" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: '#3DD68C', stroke: '#050508', strokeWidth: 2 }} />
                </LineChart>
              </ResponsiveContainer>
            </ChartPanel>
          </div>

          {/* Learning Progress Comparison */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-xs">
                Learning Progress: First 10 vs Last 10 Runs
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <ComparisonCard label="Success Rate" before={first10.successRate} after={last10.successRate} format={(v) => `${v.toFixed(0)}%`} higherIsBetter />
                <ComparisonCard label="Average Cost" before={first10.avgCost} after={last10.avgCost} format={(v) => `$${v.toFixed(2)}`} higherIsBetter={false} />
                <ComparisonCard label="Average Duration" before={first10.avgDuration} after={last10.avgDuration} format={(v) => `${v.toFixed(1)}m`} higherIsBetter={false} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ============================================ */}
        {/* INSIGHTS TAB                                 */}
        {/* ============================================ */}
        <TabsContent value="insights" className="space-y-6">
          {/* Insights Section */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Zap size={14} className="text-cortivex-cyan" />
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-text-primary">
                Discovered Insights
              </h2>
              <Badge variant="default">{insights.length}</Badge>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {insights.map((insight, i) => {
                const Icon = insightIcons[insight.action] ?? Zap;
                const color = insightColors[insight.action] ?? '#4F8EF7';
                const categoryColor = insight.category ? CATEGORY_COLORS[insight.category] ?? '#4F8EF7' : '#4F8EF7';

                return (
                  <motion.div
                    key={insight.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                  >
                    <Card className="h-full hover:border-cortivex-cyan/20 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-start gap-3">
                          <div
                            className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                            style={{ backgroundColor: `${color}15` }}
                          >
                            <Icon size={18} color={color} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-text-primary leading-relaxed mb-3">
                              {insight.pattern}
                            </p>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge
                                className="text-[9px]"
                                style={{
                                  backgroundColor: `${color}15`,
                                  color,
                                  borderColor: `${color}30`,
                                }}
                              >
                                {insight.action.replace('_', ' ')}
                              </Badge>
                              <Badge variant="success" className="text-[9px]">
                                {(insight.confidence * 100).toFixed(0)}% confidence
                              </Badge>
                              <Badge variant="secondary" className="text-[9px]">
                                {insight.basedOnRuns} runs
                              </Badge>
                              <Badge
                                className="text-[9px]"
                                style={{
                                  backgroundColor: `${categoryColor}15`,
                                  color: categoryColor,
                                  borderColor: `${categoryColor}30`,
                                }}
                              >
                                {insight.category ?? insight.action}
                              </Badge>
                            </div>
                          </div>
                        </div>
                        <Separator className="my-3" />
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] text-text-dim">
                            Impact: <span className="text-text-muted">{insight.impact ?? `${insight.basedOnRuns} runs analyzed`}</span>
                          </span>
                          <span className="text-[9px] font-mono text-text-dim">
                            {new Date(insight.discoveredAt).toLocaleDateString()}
                          </span>
                        </div>
                      </CardContent>
                    </Card>
                  </motion.div>
                );
              })}
            </div>
          </div>

          {/* Suggestions Section */}
          <div>
            <div className="flex items-center gap-3 mb-4">
              <Sparkles size={14} className="text-success-green" />
              <h2 className="text-xs font-mono font-semibold uppercase tracking-wider text-text-primary">
                Optimization Suggestions
              </h2>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {suggestions.map((suggestion, i) => (
                <SuggestionCard key={suggestion.id} suggestion={suggestion} index={i} />
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================
// SUB-COMPONENTS
// ============================================

function StatCard({
  label,
  value,
  icon,
  color,
  subtext,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: string;
  subtext?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card className="overflow-hidden">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <div style={{ color }}>{icon}</div>
            <span className="text-[10px] font-mono font-semibold uppercase tracking-wider text-text-muted">
              {label}
            </span>
          </div>
        </CardHeader>
        <CardContent className="pb-0">
          <div className="font-mono text-[28px] font-medium leading-none text-text-primary">
            {value}
          </div>
          {subtext && (
            <div className="mt-2 text-[10px] font-mono text-text-muted">{subtext}</div>
          )}
        </CardContent>
        <div
          className="mt-4 h-[2px] w-full"
          style={{ backgroundColor: color, opacity: 0.4 }}
        />
      </Card>
    </motion.div>
  );
}

function ChartPanel({
  title,
  delay = 0,
  children,
}: {
  title: string;
  delay?: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs">{title}</CardTitle>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </motion.div>
  );
}

function SuggestionCard({
  suggestion,
  index,
}: {
  suggestion: Suggestion;
  index: number;
}) {
  const typeConfig = {
    cost_optimization: {
      icon: DollarSign,
      color: '#E8A44A',
      label: 'Cost Optimization',
      badgeVariant: 'warning' as const,
    },
    quality_improvement: {
      icon: TrendingUp,
      color: '#3DD68C',
      label: 'Quality Improvement',
      badgeVariant: 'success' as const,
    },
    speed_improvement: {
      icon: Zap,
      color: '#4F8EF7',
      label: 'Speed Improvement',
      badgeVariant: 'default' as const,
    },
  }[suggestion.type];

  const Icon = typeConfig.icon;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
    >
      <Card className="h-full hover:border-cortivex-cyan/20 transition-colors">
        <CardContent className="p-4">
          <div className="flex items-start gap-3">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: `${typeConfig.color}15` }}
            >
              <Icon size={16} color={typeConfig.color} />
            </div>
            <div className="flex-1 min-w-0">
              <h4 className="text-xs font-semibold text-text-primary mb-1 font-mono">
                {suggestion.title}
              </h4>
              <p className="text-[11px] text-text-muted leading-relaxed mb-3">
                {suggestion.description}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant={typeConfig.badgeVariant} className="text-[9px]">
                  {suggestion.impact ?? 'optimization'}
                </Badge>
                <Badge variant="success" className="text-[9px]">
                  {(suggestion.confidence * 100).toFixed(0)}% confidence
                </Badge>
              </div>
            </div>
          </div>
          <Separator className="my-3" />
          <div className="flex items-center justify-end">
            <Button variant="outline" size="sm" className="text-[10px] h-7 px-3">
              Apply Suggestion
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}

function ComparisonCard({
  label,
  before,
  after,
  format,
  higherIsBetter,
}: {
  label: string;
  before: number;
  after: number;
  format: (v: number) => string;
  higherIsBetter: boolean;
}) {
  const improved = higherIsBetter ? after > before : after < before;
  const change = ((after - before) / before) * 100;

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-4">
        <h4 className="text-[10px] font-mono font-semibold uppercase tracking-wider text-text-muted mb-3">
          {label}
        </h4>
        <div className="flex items-center gap-4">
          <div className="text-center flex-1">
            <div className="text-lg font-semibold text-text-muted font-mono">{format(before)}</div>
            <div className="text-[9px] text-text-dim mt-0.5 font-mono">First 10</div>
          </div>
          <motion.div
            className={cn('text-lg', improved ? 'text-success-green' : 'text-error-coral')}
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', stiffness: 500, damping: 25, delay: 0.3 }}
          >
            {improved ? <ArrowUpRight size={20} /> : <ArrowDownRight size={20} />}
          </motion.div>
          <div className="text-center flex-1">
            <div className={cn('text-lg font-semibold font-mono', improved ? 'text-success-green' : 'text-error-coral')}>
              {format(after)}
            </div>
            <div className="text-[9px] text-text-dim mt-0.5 font-mono">Last 10</div>
          </div>
        </div>
        <div className="mt-3 text-center">
          <Badge
            variant={improved ? 'success' : 'destructive'}
            className="text-[10px]"
          >
            {change > 0 ? '+' : ''}{change.toFixed(1)}%
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
