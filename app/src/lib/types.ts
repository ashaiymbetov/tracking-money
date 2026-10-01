export interface Transaction {
  /** Номер строки в листе «Транзакции» — идентификатор для правок. */
  id: number;
  date: string;
  amount: number;
  currency: string;
  merchant: string;
  category: string;
  card: string;
  source: string;
}

export interface AppData {
  ok: true;
  generatedAt: string;
  currency: string;
  excludedCategory: string;
  uncategorized: string;
  categories: string[];
  budgets: Record<string, number>;
  /** Свои логотипы: [«если в названии есть…», сайт или ссылка на картинку]. */
  logos?: [string, string][];
  settings: { fareMax: number };
  transactions: Transaction[];
}

export interface Connection {
  url: string;
  token: string;
  demo?: boolean;
}
