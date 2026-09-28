import { Bar, BarChart, CartesianGrid, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipContentProps } from 'recharts';
import type { NameType, ValueType } from 'recharts/types/component/DefaultTooltipContent';
import { formatCompact, formatMoney, monthName, monthShortName } from '../lib/format';
import type { DayTotal, MonthKey, MonthTotal } from '../lib/stats';

const axisTick = { fill: 'var(--ink-3)', fontSize: 11 };

function TooltipBox({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl bg-ink px-3 py-2 text-bg shadow-lg">
      <div className="text-[11px] opacity-70">{title}</div>
      <div className="tnum text-sm font-semibold">{value}</div>
    </div>
  );
}

/** Траты по дням месяца: один цвет, линия среднего. */
export function DailyChart({ data, month, average }: { data: DayTotal[]; month: MonthKey; average: number }) {
  const shown = data.filter(d => !d.future);
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <BarChart data={shown} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap={2}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
          <XAxis dataKey="day" tickLine={false} axisLine={false} tick={axisTick} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} width={52} tickFormatter={formatCompact} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            content={({ active, payload }: TooltipContentProps<ValueType, NameType>) =>
              active && payload?.length ? (
                <TooltipBox title={`${payload[0].payload.day} ${monthName(month.month).toLowerCase()}`} value={formatMoney(Number(payload[0].value))} />
              ) : null}
          />
          {average > 0 && (
            <ReferenceLine y={average} stroke="var(--ink-2)" strokeWidth={1} />
          )}
          <Bar dataKey="total" fill="var(--accent)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Траты по месяцам: выбранный месяц — акцент, остальные приглушены. Нажатие выбирает месяц. */
export function MonthlyChart({ data, selected, onSelect }: { data: MonthTotal[]; selected: MonthKey; onSelect: (k: MonthKey) => void }) {
  const rows = data.map(m => ({ ...m, label: monthShortName(m.month) }));
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer>
        <BarChart data={rows} margin={{ top: 8, right: 4, bottom: 0, left: -8 }} barCategoryGap={4}>
          <CartesianGrid vertical={false} stroke="var(--line)" strokeWidth={1} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={axisTick} interval={0} />
          <YAxis tickLine={false} axisLine={false} tick={axisTick} width={52} tickFormatter={formatCompact} allowDecimals={false} />
          <Tooltip
            cursor={{ fill: 'var(--surface-2)' }}
            content={({ active, payload }: TooltipContentProps<ValueType, NameType>) =>
              active && payload?.length ? (
                <TooltipBox title={`${monthName(payload[0].payload.month)} ${payload[0].payload.year}`} value={formatMoney(Number(payload[0].value))} />
              ) : null}
          />
          <Bar dataKey="total" radius={[4, 4, 0, 0]} maxBarSize={24}
            onClick={(entry) => { const p = (entry as unknown as { payload: MonthTotal }).payload; onSelect({ year: p.year, month: p.month }); }}>
            {rows.map(m => (
              <Cell key={`${m.year}-${m.month}`} cursor="pointer"
                fill={m.year === selected.year && m.month === selected.month ? 'var(--accent)' : 'var(--ink-3)'}
                fillOpacity={m.year === selected.year && m.month === selected.month ? 1 : 0.35} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
