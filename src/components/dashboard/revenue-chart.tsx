'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { rupees } from '@/lib/format';

export interface DailyPoint {
  day: number;
  retailPaise: number;
  wholesalePaise: number;
}

/**
 * Day-by-day money in, for the current month. Retail sales and wholesale sales
 * to other shops stack, because from the shop's point of view they are the same
 * ledger — which is the whole argument the dashboard is making.
 */
export function RevenueChart({ data, today }: { data: DailyPoint[]; today: number }) {
  const hasAny = data.some((d) => d.retailPaise + d.wholesalePaise > 0);

  return (
    <div className="h-64 w-full">
      {hasAny ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 0 }} barCategoryGap={2}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              interval={2}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={52}
              tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
              tickFormatter={(v: number) => (v === 0 ? '0' : `${Math.round(v / 100000)}k`)}
            />
            <Tooltip
              cursor={{ fill: 'var(--accent)' }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const retail = Number(payload.find((p) => p.dataKey === 'retailPaise')?.value ?? 0);
                const wholesale = Number(
                  payload.find((p) => p.dataKey === 'wholesalePaise')?.value ?? 0,
                );
                return (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-sm">
                    <p className="mb-1 font-medium">Day {label}</p>
                    <p className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">Retail</span>
                      <span className="tabular-nums">{rupees(retail)}</span>
                    </p>
                    <p className="flex items-center justify-between gap-4">
                      <span className="text-muted-foreground">To other shops</span>
                      <span className="tabular-nums">{rupees(wholesale)}</span>
                    </p>
                    <p className="mt-1 flex items-center justify-between gap-4 border-t pt-1 font-medium">
                      <span>Total</span>
                      <span className="tabular-nums">{rupees(retail + wholesale)}</span>
                    </p>
                  </div>
                );
              }}
            />
            <Bar dataKey="retailPaise" stackId="money" fill="var(--chart-1)" radius={[0, 0, 2, 2]}>
              {data.map((d) => (
                // Days that have not happened yet are dimmed rather than dropped,
                // so the shape of the month stays readable mid-month.
                <Cell key={d.day} opacity={d.day > today ? 0.25 : 1} />
              ))}
            </Bar>
            <Bar dataKey="wholesalePaise" stackId="money" fill="var(--chart-2)" radius={[2, 2, 0, 0]}>
              {data.map((d) => (
                <Cell key={d.day} opacity={d.day > today ? 0.25 : 1} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="grid h-full place-items-center rounded-lg border border-dashed text-sm text-muted-foreground">
          No settled payments this month yet.
        </div>
      )}
    </div>
  );
}
