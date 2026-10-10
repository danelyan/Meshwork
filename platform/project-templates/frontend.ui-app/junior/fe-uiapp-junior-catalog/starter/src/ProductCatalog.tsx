// Компонент каталога по контракту (contract.md).
import type { Product } from './types';

export function ProductCatalog({ products }: { products: Product[] }) {
  void products;
  return <p>TODO: каталог</p>;
}
