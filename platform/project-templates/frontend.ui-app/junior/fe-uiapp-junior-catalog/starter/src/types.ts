// PLATFORM-OWNED: тип товара по контракту. Не меняйте.
export interface Product {
  id: string;
  name: string;
  category: string;
  priceRub: number;
  inStock: boolean;
}
