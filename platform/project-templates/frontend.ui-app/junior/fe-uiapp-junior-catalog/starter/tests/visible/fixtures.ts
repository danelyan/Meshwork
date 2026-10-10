// PLATFORM-OWNED: тестовые данные
import type { Product } from '../../src/types';

export const PRODUCTS: Product[] = [
  { id: 'p1', name: 'Кофе зерновой', category: 'Кофе', priceRub: 1990, inStock: true },
  { id: 'p2', name: 'Чай улун', category: 'Чай', priceRub: 750, inStock: true },
  { id: 'p3', name: 'Кофе молотый', category: 'Кофе', priceRub: 1290, inStock: false },
];
