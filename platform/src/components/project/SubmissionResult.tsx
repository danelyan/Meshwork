import type { RubricResult } from '@/server/project/schemas';

import emp from '../employer/Employer.module.css';

import { FLAG_RU } from './labels';
import styles from './Project.module.css';

/** Таблица «критерий → прошёл/нет → доказательство» (ADR 0003, ступень 2): пояснение, не балл. */
export function RubricTable({ results }: { results: RubricResult[] }) {
  if (!results.length) return null;
  return (
    <div className={emp.tableWrap}>
      <table className={emp.table}>
        <thead>
          <tr>
            <th scope="col">Критерий</th>
            <th scope="col">Итог</th>
            <th scope="col">Доказательство</th>
          </tr>
        </thead>
        <tbody>
          {results.map((r) => (
            <tr key={r.id}>
              <td>
                {r.text}
                <div className={emp.status}>{r.source === 'required' ? `обязательный${r.catalogId ? ` · ${r.catalogId}` : ''}` : 'пожелание'}</div>
              </td>
              <td className={r.passed ? styles.pass : styles.fail}>{r.passed === null ? '—' : r.passed ? 'да' : 'нет'}</td>
              <td>
                {r.evidence}
                {r.file && <div className={emp.status}>{r.file}</div>}
                {r.flag && <div className={styles.flag}>{FLAG_RU[r.flag] ?? r.flag}</div>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
