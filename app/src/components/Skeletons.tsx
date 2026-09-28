import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';

/** Серая заглушка с переливом. Перелив — transform на псевдоэлементе (GPU), без перерисовки. */
export function Sk({ className, style }: { className?: string; style?: CSSProperties }) {
  return <div aria-hidden className={clsx('skeleton', className)} style={style} />;
}

function CardSk({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx('rounded-3xl bg-surface p-4', className)}>{children}</div>;
}

function RowSk() {
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <Sk className="h-10 w-10 shrink-0 rounded-2xl" />
      <div className="flex-1 space-y-2">
        <Sk className="h-3.5 w-2/5 rounded-full" />
        <Sk className="h-3 w-3/5 rounded-full" />
      </div>
      <Sk className="h-3.5 w-14 rounded-full" />
    </div>
  );
}

function BarRowSk({ w }: { w: string }) {
  return (
    <div className="flex items-center gap-3 px-1 py-2">
      <Sk className="h-9 w-9 shrink-0 rounded-2xl" />
      <div className="flex-1 space-y-2.5">
        <div className="flex justify-between"><Sk className="h-3.5 w-1/3 rounded-full" /><Sk className="h-3.5 w-16 rounded-full" /></div>
        <Sk className="h-1.5 rounded-full" style={{ width: w }} />
      </div>
    </div>
  );
}

export function ChartSk() {
  const heights = [40, 72, 30, 55, 90, 45, 65, 25, 80, 50, 60, 35];
  return (
    <div className="flex h-48 items-end gap-1.5 px-1 pb-5">
      {heights.map((h, i) => <Sk key={i} className="flex-1 rounded-t-[4px] rounded-b-none" style={{ height: `${h}%` }} />)}
    </div>
  );
}

export function HomeSkeleton() {
  return (
    <div className="space-y-3">
      <div className="rounded-[28px] p-5" style={{ background: 'linear-gradient(135deg, var(--hero-from), var(--hero-to))' }}>
        <div className="skeleton-on-hero h-3.5 w-40 rounded-full" />
        <div className="skeleton-on-hero mt-3 h-11 w-52 rounded-2xl" />
        <div className="skeleton-on-hero mt-4 h-6 w-64 rounded-full" />
        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="skeleton-on-hero h-14 rounded-2xl" />
          <div className="skeleton-on-hero h-14 rounded-2xl" />
        </div>
      </div>
      <CardSk>
        <Sk className="mb-3 h-4 w-32 rounded-full" />
        {['92%', '74%', '60%', '38%', '22%'].map(w => <BarRowSk key={w} w={w} />)}
      </CardSk>
      <CardSk>
        <Sk className="mb-3 h-4 w-40 rounded-full" />
        {[0, 1, 2].map(i => <RowSk key={i} />)}
      </CardSk>
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="space-y-3">
      <Sk className="h-12 rounded-2xl" />
      <div className="flex gap-2">{[56, 92, 80, 70].map(w => <Sk key={w} className="h-8 shrink-0 rounded-full" style={{ width: w }} />)}</div>
      {[3, 2, 4].map((n, i) => (
        <CardSk key={i} className="py-3">
          <div className="mb-1 flex justify-between px-1"><Sk className="h-3 w-28 rounded-full" /><Sk className="h-3 w-12 rounded-full" /></div>
          {Array.from({ length: n }, (_, j) => <RowSk key={j} />)}
        </CardSk>
      ))}
    </div>
  );
}

export function AnalyticsSkeleton() {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map(i => (
          <CardSk key={i}><Sk className="h-3 w-20 rounded-full" /><Sk className="mt-2.5 h-5 w-24 rounded-full" /></CardSk>
        ))}
      </div>
      <CardSk><Sk className="mb-3 h-4 w-20 rounded-full" /><ChartSk /></CardSk>
      <CardSk><Sk className="mb-3 h-4 w-28 rounded-full" /><ChartSk /></CardSk>
      <CardSk>
        <Sk className="mb-3 h-4 w-32 rounded-full" />
        {['90%', '65%', '40%'].map(w => <BarRowSk key={w} w={w} />)}
      </CardSk>
    </div>
  );
}

export function BudgetsSkeleton() {
  return (
    <div className="space-y-3">
      <CardSk><Sk className="h-3 w-36 rounded-full" /><Sk className="mt-3 h-7 w-48 rounded-full" /></CardSk>
      <CardSk>
        <Sk className="mb-3 h-4 w-20 rounded-full" />
        {['80%', '55%', '30%'].map(w => <BarRowSk key={w} w={w} />)}
      </CardSk>
    </div>
  );
}
