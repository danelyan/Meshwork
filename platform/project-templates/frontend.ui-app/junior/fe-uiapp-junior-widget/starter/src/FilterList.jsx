import React from 'react';

// Точка входа по контракту (contract.md).
export default function FilterList({ items }) {
  return (
    <ul>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}
