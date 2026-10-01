import { memo, useState } from 'react';
import { CategoryBadge } from '../lib/categories';
import { logoCandidates, logoSourceFor } from '../lib/logos';
import { useLogos } from '../lib/logoContext';

// Адреса, которые уже не загрузились, — чтобы не пробовать заново и не мигать.
const failed = new Set<string>();

/** Логотип места, а если его нет или он не загрузился — иконка категории. */
export const MerchantAvatar = memo(function MerchantAvatar({ merchant, category, logos, size = 40 }: {
  merchant: string;
  category: string;
  logos?: [string, string][];
  size?: number;
}) {
  const ctxLogos = useLogos();
  const source = logoSourceFor(merchant, logos ?? ctxLogos);
  const candidates = source ? logoCandidates(source).filter(u => !failed.has(u)) : [];
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const src = candidates[index];

  if (!src) return <CategoryBadge category={category} size={size} />;

  const next = () => { failed.add(src); setLoaded(false); setIndex(i => i + 1); };
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      {!loaded && <span className="absolute inset-0"><CategoryBadge category={category} size={size} /></span>}
      <span
        className="inline-flex items-center justify-center overflow-hidden rounded-2xl bg-white shadow-[inset_0_0_0_1px_rgb(0_0_0/0.06)] transition-opacity duration-200"
        style={{ width: size, height: size, opacity: loaded ? 1 : 0 }}
      >
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          width={Math.round(size * 0.66)}
          height={Math.round(size * 0.66)}
          className="object-contain"
          onLoad={e => {
            // Сервисы иконок отдают крошечную заглушку, если иконки нет (просили 128 px) — считаем это неудачей.
            if (e.currentTarget.naturalWidth < 24) next();
            else setLoaded(true);
          }}
          onError={next}
        />
      </span>
    </span>
  );
});
