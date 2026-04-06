'use client';

import { use, useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  useGa4Dimensions,
  useGa4Metrics,
  useRunReport,
} from '@/hooks/use-analytics';
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

const COLORS = [
  '#000000', '#666666', '#999999', '#333333',
  '#444444', '#777777', '#aaaaaa', '#555555',
];

function getDateRange(preset: string): { startDate: string; endDate: string } {
  const end = new Date();
  const start = new Date();
  if (preset === '7d') start.setDate(end.getDate() - 7);
  else if (preset === '30d') start.setDate(end.getDate() - 30);
  else if (preset === '90d') start.setDate(end.getDate() - 90);

  return {
    startDate: start.toISOString().split('T')[0],
    endDate: end.toISOString().split('T')[0],
  };
}

function inferChartType(dimensions: string[]): 'line' | 'bar' | 'pie' {
  if (dimensions.includes('date')) return 'line';
  if (dimensions.length === 1) return 'pie';
  return 'bar';
}

export default function Ga4ReportsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: projectId } = use(params);

  const { data: availableDimensions } = useGa4Dimensions();
  const { data: availableMetrics } = useGa4Metrics();
  const runReport = useRunReport();

  const [selectedDimensions, setSelectedDimensions] = useState<string[]>(['date']);
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(['activeUsers']);
  const [datePreset, setDatePreset] = useState('30d');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  const reportData = runReport.data;

  const MAX_DIMENSIONS = 9;

  function toggleItem(list: string[], item: string, setter: (v: string[]) => void, max?: number) {
    if (list.includes(item)) {
      setter(list.filter((i) => i !== item));
    } else {
      if (max && list.length >= max) return;
      setter([...list, item]);
    }
  }

  function handleRunReport() {
    const range =
      datePreset === 'custom'
        ? { startDate: customStart, endDate: customEnd }
        : getDateRange(datePreset);

    runReport.mutate({
      projectId,
      dimensions: selectedDimensions,
      metrics: selectedMetrics,
      ...range,
    });
  }

  function getChartData() {
    if (!reportData?.rows) return [];
    return reportData.rows.map((row: any) => {
      const obj: any = {};
      reportData.dimensionHeaders.forEach((h: string, i: number) => {
        obj[h] = row.dimensions[i];
      });
      reportData.metricHeaders.forEach((h: any, i: number) => {
        obj[h.name] = parseFloat(row.metrics[i]);
      });
      return obj;
    });
  }

  const chartData = getChartData();
  const chartType = inferChartType(selectedDimensions);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">GA4 Reports</h1>

      {/* Query Builder */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Report Builder</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Date Range */}
          <div className="space-y-2">
            <Label>Date Range</Label>
            <div className="flex gap-2">
              {['7d', '30d', '90d', 'custom'].map((preset) => (
                <Button
                  key={preset}
                  size="sm"
                  variant={datePreset === preset ? 'default' : 'outline'}
                  onClick={() => setDatePreset(preset)}
                >
                  {preset === 'custom' ? 'Custom' : preset}
                </Button>
              ))}
            </div>
            {datePreset === 'custom' && (
              <div className="flex gap-2 mt-2">
                <Input
                  type="date"
                  value={customStart}
                  onChange={(e) => setCustomStart(e.target.value)}
                />
                <Input
                  type="date"
                  value={customEnd}
                  onChange={(e) => setCustomEnd(e.target.value)}
                />
              </div>
            )}
          </div>

          {/* Dimensions */}
          <div className="space-y-2">
            <Label>Dimensions ({selectedDimensions.length}/{MAX_DIMENSIONS})</Label>
            <div className="flex flex-wrap gap-1">
              {availableDimensions?.map((d: any) => {
                const selected = selectedDimensions.includes(d.name);
                const atLimit = selectedDimensions.length >= MAX_DIMENSIONS;
                return (
                  <Button
                    key={d.name}
                    size="sm"
                    variant={selected ? 'default' : 'outline'}
                    disabled={!selected && atLimit}
                    onClick={() =>
                      toggleItem(selectedDimensions, d.name, setSelectedDimensions, MAX_DIMENSIONS)
                    }
                  >
                    {d.description}
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Metrics */}
          <div className="space-y-2">
            <Label>Metrics</Label>
            <div className="flex flex-wrap gap-1">
              {availableMetrics?.map((m: any) => (
                <Button
                  key={m.name}
                  size="sm"
                  variant={
                    selectedMetrics.includes(m.name) ? 'default' : 'outline'
                  }
                  onClick={() =>
                    toggleItem(selectedMetrics, m.name, setSelectedMetrics)
                  }
                >
                  {m.description}
                </Button>
              ))}
            </div>
          </div>

          <Button
            onClick={handleRunReport}
            disabled={
              runReport.isPending ||
              selectedDimensions.length === 0 ||
              selectedMetrics.length === 0
            }
          >
            {runReport.isPending ? 'Running...' : 'Run Report'}
          </Button>
        </CardContent>
      </Card>

      {/* Error */}
      {runReport.isError && (
        <Card>
          <CardContent className="py-4 text-destructive">
            Error: {(runReport.error as Error).message}
          </CardContent>
        </Card>
      )}

      {reportData && (
        <>
          {/* Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Chart ({reportData.rowCount} rows)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  {chartType === 'line' ? (
                    <LineChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey={reportData.dimensionHeaders[0]} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {reportData.metricHeaders.map((m: any, i: number) => (
                        <Line
                          key={m.name}
                          type="monotone"
                          dataKey={m.name}
                          stroke={COLORS[i % COLORS.length]}
                        />
                      ))}
                    </LineChart>
                  ) : chartType === 'pie' ? (
                    <PieChart>
                      <Tooltip />
                      <Legend />
                      <Pie
                        data={chartData}
                        dataKey={reportData.metricHeaders[0]?.name}
                        nameKey={reportData.dimensionHeaders[0]}
                        cx="50%"
                        cy="50%"
                        outerRadius={120}
                      >
                        {chartData.map((_: any, i: number) => (
                          <Cell
                            key={i}
                            fill={COLORS[i % COLORS.length]}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  ) : (
                    <BarChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey={reportData.dimensionHeaders[0]} />
                      <YAxis />
                      <Tooltip />
                      <Legend />
                      {reportData.metricHeaders.map((m: any, i: number) => (
                        <Bar
                          key={m.name}
                          dataKey={m.name}
                          fill={COLORS[i % COLORS.length]}
                        />
                      ))}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Table */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Data Table</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      {reportData.dimensionHeaders.map((h: string) => (
                        <th key={h} className="py-2 pr-4 text-left font-medium">
                          {h}
                        </th>
                      ))}
                      {reportData.metricHeaders.map((h: any) => (
                        <th
                          key={h.name}
                          className="py-2 pr-4 text-right font-medium"
                        >
                          {h.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {reportData.rows.map((row: any, i: number) => (
                      <tr key={i} className="border-b">
                        {row.dimensions.map((v: string, j: number) => (
                          <td key={j} className="py-2 pr-4">
                            {v}
                          </td>
                        ))}
                        {row.metrics.map((v: string, j: number) => (
                          <td key={j} className="py-2 pr-4 text-right tabular-nums">
                            {parseFloat(v).toLocaleString()}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
