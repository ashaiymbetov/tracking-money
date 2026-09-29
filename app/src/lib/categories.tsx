import {
  ArrowLeftRight, Bike, Bus, CarTaxiFront, CircleHelp, Clapperboard, Ellipsis, EyeOff, Fuel, HeartPulse,
  House, Landmark, Package, Repeat, Shirt, ShoppingBasket, Smartphone, Sofa, Users, UtensilsCrossed, Zap,
  type LucideIcon
} from 'lucide-react';

const ICONS: Record<string, LucideIcon> = {
  'Продукты': ShoppingBasket,
  'Кафе и еда': UtensilsCrossed,
  'Доставка еды': Bike,
  'Здоровье': HeartPulse,
  'Транспорт': Bus,
  'Такси': CarTaxiFront,
  'Авто': Fuel,
  'Связь': Smartphone,
  'Подписки': Repeat,
  'Покупки онлайн': Package,
  'Развлечения': Clapperboard,
  'Переводы': ArrowLeftRight,
  'Семья': Users,
  'Коммуналка': Zap,
  'Одежда': Shirt,
  'Дом': Sofa,
  'Жильё': House,
  'Кредит и комиссии': Landmark,
  'Другое': Ellipsis,
  'Без категории': CircleHelp,
  'Не учитывать': EyeOff
};

export function categoryIcon(category: string): LucideIcon {
  return ICONS[category] ?? Ellipsis;
}

export function CategoryBadge({ category, size = 40 }: { category: string; size?: number }) {
  const Icon = categoryIcon(category);
  const muted = category === 'Без категории' || category === 'Не учитывать';
  return (
    <span
      className={
        'inline-flex shrink-0 items-center justify-center rounded-2xl ' +
        (muted ? 'bg-surface-2 text-ink-3' : 'bg-accent-soft text-accent-ink')
      }
      style={{ width: size, height: size }}
    >
      <Icon size={Math.round(size * 0.48)} strokeWidth={2} />
    </span>
  );
}
