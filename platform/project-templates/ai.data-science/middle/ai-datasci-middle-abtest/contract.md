<!-- PLATFORM-OWNED: файл платформы, правки кандидата игнорируются при проверке -->
# Контракт: анализ A/B-теста (ai.data-science, middle)

Модуль `abtest.py` в корне репозитория. Окружение: Python 3.12, `pandas` 2.3.3, `numpy` 2.3.3, стандартная библиотека
(`math`, `statistics.NormalDist`), `pytest`. `scipy` недоступен; сеть недоступна. Генератор случайных чисел не нужен:
все формулы ниже детерминированы. Входной `DataFrame` не изменяется.

```python
def sample_size(baseline: float, mde: float, alpha: float = 0.05, power: float = 0.8) -> int
def check_srm(n_control: int, n_treatment: int, expected_control_share: float = 0.5, alpha: float = 0.001) -> dict
def analyze(df: pd.DataFrame, alpha: float = 0.05, srm_alpha: float = 0.001, winsor_q: float = 0.99) -> dict
```

Обозначения: `z(p) = NormalDist().inv_cdf(p)`; двустороннее p-value для статистики `z` — `erfc(|z| / sqrt(2))`
(`math.erfc`); дисперсия — выборочная (`ddof=1`).

## `sample_size`

Объём одной группы для двух пропорций: `p1 = baseline`, `p2 = baseline + mde` (`mde` — абсолютный прирост),
`n = (z(1 - alpha/2) + z(power))² · (p1(1-p1) + p2(1-p2)) / mde²`, результат — `math.ceil(n)`.
`baseline` не в `(0, 1)`, `p2` не в `(0, 1)` или `mde == 0` → `ValueError`.

## `check_srm`

Критерий хи-квадрат согласия, 1 степень свободы. `N = n_control + n_treatment`, ожидаемые
`E_c = N · expected_control_share`, `E_t = N - E_c`; `chi2 = Σ (O - E)² / E`; `p_value` — для 1 степени свободы
`erfc(sqrt(chi2 / 2))`. Результат: `{"chi2": float, "p_value": float, "srm": p_value < alpha}`.
`N == 0` или `expected_control_share` не в `(0, 1)` → `ValueError`.

## `analyze`

Вход — по одной строке на пользователя: `user_id`, `group` (`"control"` или `"treatment"`),
`converted` (0/1, допускается `bool`), `revenue` (≥ 0; у не сконвертировавшихся обычно 0).

Ошибки (`ValueError`, проверяются до расчётов, в этом порядке): нет колонки — `"missing column: <имя>"`;
`group` вне допустимых значений — `"bad group"`; `converted` не из {0, 1} — `"bad converted"`;
`revenue` пропущена или отрицательна — `"bad revenue"`; повтор `user_id` — `"duplicate user_id"`;
в какой-то группе нет строк — `"empty group"`.

Результат — словарь:

- `"n"`: `{"control": int, "treatment": int}`.
- `"srm"`: результат `check_srm` для фактических размеров групп при `expected_control_share = 0.5` и `alpha = srm_alpha`.
- `"conversion"` (первичная метрика): `control_rate`, `treatment_rate`, `diff = treatment_rate - control_rate`;
  `se = sqrt(pc(1-pc)/nc + pt(1-pt)/nt)`; `ci_low`/`ci_high = diff ∓ z(1 - alpha/2) · se`;
  `z` и `p_value` — двусторонний z-тест с объединённой долей `p = (kc + kt)/(nc + nt)` и
  `se_pooled = sqrt(p(1-p)(1/nc + 1/nt))`: `z = diff / se_pooled` (если `se_pooled == 0` — `z = 0.0`, `p_value = 1.0`);
  `significant = p_value < alpha`.
- `"revenue"` (вторичная метрика, со «срезкой» выбросов): `cap = numpy.quantile(revenue всех пользователей, winsor_q)`
  (линейная интерполяция); выручка каждого пользователя ограничивается сверху значением `cap`
  (`min(revenue, cap)`) до всех расчётов. Далее по группам: `mean_control`, `mean_treatment`,
  `diff = mean_treatment - mean_control`, `se = sqrt(vc/nc + vt/nt)` (критерий Уэлча, `vc`, `vt` — выборочные дисперсии;
  при `n = 1` в группе дисперсия считается `0.0`), `ci_low`/`ci_high = diff ∓ z(1 - alpha/2) · se`,
  `z = diff / se` (при `se == 0` — `0.0`, `p_value = 1.0`), `p_value`, `significant = p_value < alpha`, и `cap`.
- `"decision"` — по первичной метрике: `"invalid"`, если `srm["srm"]` (результат нельзя интерпретировать);
  иначе `"win"`, если конверсия значима и `diff > 0`; `"loss"`, если значима и `diff < 0`; иначе `"inconclusive"`.

Видимые тесты — `tests/visible/` (`python -m pytest tests/visible`).
