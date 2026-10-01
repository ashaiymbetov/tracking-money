import { describe, expect, it } from 'vitest';
import { logoCandidates, logoSourceFor, merchantsWithoutLogo } from './logos';

describe('логотипы', () => {
  it('встроенные: Globus, Азия, Тулпар в разном написании', () => {
    expect(logoSourceFor('GLOBUS 15 KALYKA-AKIEVA')).toBe('globus.kg');
    expect(logoSourceFor('Глобус')).toBe('globus.kg');
    expect(logoSourceFor('Азия')).toBe('asia.kg');
    expect(logoSourceFor('Tulpar-Card')).toBe('tulpar-card.kg');
    expect(logoSourceFor('YANDEX.GO SAMOKATY KG')).toBe('yandex.com');
    expect(logoSourceFor('Непонятное место')).toBeNull();
  });

  it('свои логотипы важнее встроенных', () => {
    expect(logoSourceFor('KFC - Кант', [['kfc', 'kfc.kg']])).toBe('kfc.kg');
    expect(logoSourceFor('InterSport 1 1000 meloc', [['intersport', 'intersport.kg']])).toBe('intersport.kg');
  });

  it('адреса картинок: сайт → сервисы иконок, ссылка на картинку — как есть', () => {
    expect(logoCandidates('https://www.Globus.kg/ru')[0]).toBe('https://www.google.com/s2/favicons?domain=globus.kg&sz=128');
    expect(logoCandidates('https://cdn.example.com/logo.png')).toEqual(['https://cdn.example.com/logo.png']);
  });

  it('кому искать логотип: без людей, переводов, комиссий и уже известных мест; по частоте', () => {
    const txs = [
      { merchant: 'InterSport 1 1000 meloc', category: 'Одежда' },
      { merchant: 'Imperiya Pitstsy Oshskiy', category: 'Кафе и еда' },
      { merchant: 'Imperiya Pitstsy Oshskiy', category: 'Кафе и еда' },
      { merchant: 'Globus', category: 'Продукты' },
      { merchant: 'Арсыбаева А. Т.', category: 'Без категории' },
      { merchant: 'Айбек К.', category: 'Переводы' },
      { merchant: 'Комиссия Simbank', category: 'Кредит и комиссии' }
    ];
    expect(merchantsWithoutLogo(txs)).toEqual(['Imperiya Pitstsy Oshskiy', 'InterSport 1 1000 meloc']);
  });
});
