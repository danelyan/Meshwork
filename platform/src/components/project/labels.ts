// Подписи ступени 2 для интерфейса (lane project).
export const SUBMISSION_STATUS: Record<string, string> = {
  submitted: 'в очереди',
  running: 'проверяется',
  checked: 'проверено',
  failed: 'ошибка проверки',
};

export const GRADE_RU: Record<string, string> = { junior: 'Junior', middle: 'Middle', senior: 'Senior' };

export const FLAG_RU: Record<string, string> = {
  evidence_unverified: 'ссылка на файл не подтвердилась',
  no_evidence: 'нет доказательства',
  possible_prompt_injection: 'в коде или журнале — попытка повлиять на проверку',
  not_evaluated: 'не оценено',
};

export function hours(min: number): string {
  const h = Math.round((min / 60) * 10) / 10;
  return `≈ ${String(h).replace('.', ',')} ч`;
}
