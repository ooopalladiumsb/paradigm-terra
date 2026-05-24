# Paradigm Terra — Changelog & Decision Log v0.10.0-draft

**Дата:** 2026-05-23
**Базовая редакция:** Конституция v0.9.5 (SCF) + Canonical Encoding v1.3 (Consensus-Freeze) + Constraint DSL v1.1 (SCF)
**Целевая редакция:** Конституция v0.10.0-draft + CAL Execution Specification v0.1.0-draft + DSL Specification v0.1.0-draft
**Статус:** все три новых документа выходят как `v0.1.0-draft`, под совместной Tier 3 ратификацией вместе с конституцией v0.10.0.

---

## 1. Назначение документа

Этот документ — нормативный «changelog», фиксирующий:

1. **Какие архитектурные вопросы были заданы** при подготовке пакета v0.10.0.
2. **Какие решения приняты** (с пометкой `[Recommended]` где применимо).
3. **Какие документы и разделы затрагивает** каждое решение.
4. **В каком новом артефакте оно нормативно закреплено** (`CONSTITUTION`, `CAL_SPEC`, `DSL_SPEC`).

Документ сам по себе **не нормативен**: при любом расхождении приоритет имеют целевые спецификации. Документ служит:
- картой обратной трассируемости (decision → spec section);
- основанием для Tier 3 amendment ratification;
- архивной справкой для будущих ревизий.

---

## 2. Условные обозначения

| Тег | Значение |
|-----|----------|
| `[R]` | Рекомендованный вариант, принятый как нормативный |
| `→ CONST §X` | Затрагивает Конституцию, секцию X (v0.10.0-draft) |
| `→ CAL §X` | Затрагивает CAL Execution Spec v0.1.0-draft |
| `→ DSL §X` | Затрагивает DSL Specification v0.1.0-draft |
| `→ CE §X` | Затрагивает Canonical Encoding Spec v1.3 (без правки оригинала, только ссылка) |

---

## 3. Блок Q1 — CAL Lifecycle & Validation

### Q1.1 — Модель ончейн-исполнения CAL

**Решение:** (A) Все стадии CAL — отдельные ончейн events / contract calls.
**Обоснование:** event-sourcing является конституционным инвариантом (Глава I §2, §14); все переходы стадий должны быть детерминированно реплейябельны.
**Затрагивает:**
- `→ CAL §3 (Lifecycle State Machine)` — нормативный перечень event types per stage.
- `→ CONST §IV (CAL)` — расширение жизненного цикла указанием event types.

### Q1.2 — Кто такой Validator

**Решение:** Validator = узел, выполняющий проверку соответствия профилю агента согласно действующей §5.3 Конституции («Перед каждым MCP-вызовом проверяется соответствие профилю агента; три нарушения в течение 100 тиков → автоматическая заморозка»).
**Обоснование:** валидатор — детерминированный участник консенсуса, а не отдельная роль; он применяет capability-проверки до диспатча MCP-вызова.
**Затрагивает:**
- `→ CAL §4 (Validator Role)` — формальное определение валидатора, его state input (`state.registry.agents[*]`, `state.cal.in_flight[*]`), его выходы (VALIDATED / FAILED event).
- `→ CONST §V.3` — добавление обратной ссылки на CAL §4.

### Q1.3 — Семантика частичного отказа

**Решение:** (A) `[R]` **All-or-nothing.** При любом сбое в `steps[]` — весь CAL переводится в `FAILED`, ни один шаг не считается применённым, `nonce` сжигается (anti-replay), генерируется receipt с `status: "failed"` и причиной.
**Обоснование:** атомарность исключает класс багов «полу-применённых» CAL, упрощает доказательство инвариантов и совместима с TON-моделью транзакций.
**Затрагивает:**
- `→ CAL §3.5 (Failure Semantics)`, `→ CAL §5 (Receipts)`.
- `→ DSL §4 (Post-conditions)` — post-conditions не выполняются при FAILED.

### Q1.4 — Где проверяется `expiration_tick`

**Решение:** (A) `[R]` Проверяется на стадии VALIDATED; CAL действителен, если `current_tick ≤ expiration_tick` в момент валидации. После SIGNED исполнение должно завершиться до `expiration_tick`, иначе CAL переходит в `EXPIRED`.
**Затрагивает:**
- `→ CAL §3.2 (VALIDATED stage)`, `→ CAL §3.6 (EXPIRED terminal state)`.

### Q1.5 — Серилизация CAL одного агента

**Решение:** (A) `[R]` CAL одного агента сериализуются по `(agent_id, nonce)`. Следующий CAL принимается только после `FINALIZED / FAILED / EXPIRED` предыдущего.
**Обоснование:** предотвращает реплей и гонки между параллельными CAL одного агента; согласуется с моделью nonce в `state.cal.nonces[agent_id]`.
**Затрагивает:**
- `→ CAL §6 (Concurrency & Nonce Discipline)`.
- `→ CONST §X (state.cal)` — уточнение поведения `nonces[agent_id]` и `in_flight[cal_hash]`.

### Q1.6 — Формат receipt

**Решение:** `[R]` Receipt — это event типа `cal.finalized` с canonical hashing (domain tag `PARADIGM_TERRA_RECEIPT_V1`), хранится в общем Event Log. Никаких отдельных contracts для receipts.
**Затрагивает:**
- `→ CAL §5 (Receipts)`.
- `→ CE §7.1` — `PARADIGM_TERRA_RECEIPT_V1` уже существует, дополнительная фиксация семантики.

---

## 4. Блок Q2 — State Model

### Q2.1 — Финальный исчерпывающий перечень `state.<namespace>.<path>`

**Решение:** принят перечень из 8 namespace (см. полный текст в исходных ответах). Сводно:

| Namespace | Текущее (v0.9.5) | Добавлено в v0.10.0 |
|-----------|------------------|---------------------|
| `state.tick` | `current`, `genesis`, `blocks_per_tick` | `epoch` |
| `state.registry` | `agents[agent_id]` | `mcp_schema_hash`, `protocols[protocol_id]` |
| `state.treasury` | `nav`, `outflow_window`, `developer_fund_balance`, `staking_pool`, `slot_pool` | `collected_fees_window` |
| `state.governance` | `slots[slot_id]`, `active_proposals`, `cartel_flags` | `cluster_detection`, `proposal_votes[proposal_id]` |
| `state.oracles` | `nodes[oracle_id]`, `feeds.<symbol>` | `slashed_nodes[oracle_id]` |
| `state.ptra` | `total_supply`, `burned_total`, `burned_window`, `twap_ton_ratio`, `stakes[address]` | `balances[address]` |
| `state.failure_mode` | `current`, `entered_at`, `recovery_progress` | `is_bounded_mode`, `capture_guard_counters[metric_id]` |
| `state.cal` | `nonces[agent_id]`, `in_flight[cal_hash]` | (без изменений) |

**Затрагивает:**
- `→ CONST §X (State Layout)` — новая глава или расширение Главы X с явным перечислением.
- `→ DSL §3.4 (Variables)` — обновлённый whitelist путей.
- `→ CAL §3 (Lifecycle)` — все event applies ссылаются на этот перечень.

### Q2.2 — Snapshot для VALIDATED

**Решение:** (A) `[R]` На стадии VALIDATED читается snapshot **последнего финализированного тика** (детерминированно).
**Обоснование:** исключает race condition и недетерминированность, согласуется с Главой X (детерминированный реплей).
**Затрагивает:**
- `→ CAL §4.2 (State View at VALIDATED)`.

### Q2.3 — Reducer applies events

**Решение:** (A) `[R]` Единый `apply(state, event) → state'`, switch по `event.type`. Все event types и их state-effects явно перечислены в спецификации.
**Затрагивает:**
- `→ CAL §7 (Event Reducer)` — нормативная таблица event type → state mutation.
- `→ CONST §I.14` — подтверждение event-sourcing инварианта.

### Q2.4 — Алгоритм state root

**Решение:** (A) `[R]` Merkle root над canonical-serialized namespaces (sorted by namespace name, лексикографически). Алгоритм: бинарный Merkle с domain tag `PARADIGM_TERRA_STATE_ROOT_V1`.
**Затрагивает:**
- `→ CE §7.1` — добавление нового domain tag `PARADIGM_TERRA_STATE_ROOT_V1` (Tier 2 amendment к CE).
- `→ CONST §III.2` — упоминание `STATE_ROOT_V1`.
- `→ CAL §7.3 (State Root Computation)`.

### Q2.5 — Взаимодействие с TEP-74 transfers

**Решение:** (B) Paradigm Terra зеркалирует TEP-74 transfers как собственные events.
**Обоснование:** обеспечивает целостность Event Log независимо от внешней jetton-инфраструктуры; reorgs и indexer drift не нарушают replay.
**Затрагивает:**
- `→ CAL §7.4 (External Event Mirroring)`.
- `→ CE §3.5` — `PARADIGM_TERRA_JETTON_TRANSFER_V1` уже зарегистрирован, дополнительная фиксация семантики mirror.

---

## 5. Блок Q3 — DSL Extensions

### Q3.1 — Post-conditions

**Решение:** Добавить `post_conditions` per step (между `preconditions` всего CAL и `invariants` всего CAL).
**Затрагивает:**
- `→ CAL §2.2 (CAL Structure)` — новое поле `steps[i].post_conditions`.
- `→ DSL §4 (Post-conditions)`.

### Q3.2 — Семантика post-conditions

**Решение:** `[R]` DSL-выражения, проверяемые post-execution с доступом к `state.before` и `state.after`. Расширение DSL §3.4 — фиксируется в **DSL v1.2** (для совместимости с существующей DSL v1.1 реализацией). Однако новый документ публикуется как `DSL Specification v0.1.0-draft`, который **профилирует** DSL v1.2 для использования внутри CAL Execution Spec.
**Затрагивает:**
- `→ DSL §3.4 (Variables)` — добавление `state.before.*` и `state.after.*`.
- `→ DSL §4 (Post-conditions Evaluation)`.

### Q3.3 — Кто подписывает CAL

**Решение:** `[R]` По умолчанию подписывает **operator key**. Для действий из enum `OWNER_REQUIRED_ACTIONS` (например, изменение capability profile, transfer > threshold, governance vote от агента) требуется **co-sign owner key**. Список `OWNER_REQUIRED_ACTIONS` — Tier 2 amendable.
**Затрагивает:**
- `→ CAL §8 (Signing Model)` — нормативный enum + правила co-sign.
- `→ CONST §V` — обновление профиля agent capability с явным указанием signing tier.

### Q3.4 — Что такое `action`

**Решение:** (B) `[R]` Registered taxonomy: `action = namespace.verb` из реестра. Добавление новых действий — Tier 2 amendment.
**Обоснование:** гарантирует машинную проверку capability/invariants per action type.
**Затрагивает:**
- `→ CAL §2.3 (Action Taxonomy)` — нормативный реестр.
- `→ DSL §5 (Action Reference)` — список разрешённых namespace.verb.
- `→ CONST §IV` — ссылка на реестр.

### Q3.5 — Capability Gate в DSL

**Решение:** (B) `[R]` (по контексту: Capability Gate проверяется декларативно в preconditions через DSL).
**Затрагивает:**
- `→ DSL §6 (Capability Gates)`.
- `→ CAL §4 (Validator Role)`.

### Q3.6 — Versioning

**Решение:** (A) `[R]` Обе новых спецификации — `v0.1.0-draft`, ратифицируются под Tier 3 совместно с Конституцией v0.10.0.
**Затрагивает:**
- `→ CAL §1 (Status)`, `→ DSL §1 (Status)`.

---

## 6. Глобальные решения

### 6.1. Язык новых документов

**Решение:** EN (English).
**Обоснование:** соответствует §13.5 Конституции — протокольные идентификаторы и нормативные спецификации остаются ASCII/EN. Локализация — на уровне приложения.

### 6.2. Модель газа (Gas Model)

**Решение:** двухстадийная асимметричная модель.

```
[MEMPOOL]    CREATED/SIGNED    → платится в TON (network ingress fee)
[VALIDATION] VALIDATED         → Flat_Validation_Fee в PTRA (upfront deposit)
[EXECUTION]  EXECUTED          → Dynamic Gas (PTRA) per DSL op + per MCP call + State Rent
```

**Ключевые правила:**
- Upfront deposit для VALIDATED обязателен. Если preconditions не прошли — deposit сжигается как flat spam fee, CAL → FAILED.
- Out-of-gas при EXECUTED → полный rollback к `state.before` (Q3.2), но сожжённый газ списывается в пользу валидаторов.
- Каждая инструкция DSL, каждый MCP-вызов (`namespace.verb`), каждая проверка инварианта имеют фиксированную стоимость в Gas Units.

**Затрагивает:**
- `→ CAL §9 (Gas Model)` — полная спецификация.
- `→ CONST §IV` — ссылка на gas model в описании CAL lifecycle.
- `→ CONST §XV` — упоминание, что Flat Validation Fee и Dynamic Gas — единственные обязательные расходы PTRA-баланса агента.

### 6.3. Bounded Mode (расширенная спецификация)

**Триггеры (детерминированно из `state.tick`):**
- `state.failure_mode.capture_guard_counters` > критический порог (например, >30% оракулов не прислали фиды за окно тиков).
- `state.treasury.nav` упал >X% за один тик.

**Поведение CAL-движка при `is_bounded_mode == true`:**
1. **Action Whitelisting** — все `namespace.verb` блокируются кроме явного whitelist (`failure_mode.emergency_withdraw`, `oracles.force_update`, и т.п.).
2. **Emergency Invariants** — рантайм автоматически подмешивает глобальный инвариант:
   `state.after.treasury.developer_fund_balance ≥ state.before.treasury.developer_fund_balance`
3. **Signature Escalation** — все действия, требовавшие только Operator Key, перемещаются в `OWNER_REQUIRED_ACTIONS` (требуют co-sign owner).

**Затрагивает:**
- `→ CAL §10 (Bounded Mode)`.
- `→ CONST §VI` — расширение таблицы failure states новым подрежимом.
- `→ DSL §7 (Emergency Invariants)`.

### 6.4. Обратная совместимость с pre-PTRA CAL

1. **Shadow Balances v1.1** — для агентов без PTRA-кошелька рантайм инициализирует `state.ptra.balances[agent_id] = 0` при первом обращении.
2. **Capability Gate Emulation** — `#pragma compatibility_mode` в CAL направляет проверку на legacy reducer (raw TON-адрес vs genesis-validator list).
3. **Gas Legacy Bridge** — спонсорская подпись в CAL-конверте позволяет третьей стороне платить PTRA за стадии VALIDATED/EXECUTED в обмен на nanoTON на транспортном слое.

**Затрагивает:**
- `→ CAL §11 (Backwards Compatibility)`.
- `→ CONST §XVI` — упоминание compatibility window.

---

## 7. Чек-лист изменений для Constitution v0.10.0-draft

- [ ] §IV CAL — добавить ссылку на CAL Execution Spec v0.1.0-draft.
- [ ] §V.3 — добавить ссылку на CAL §4 (Validator).
- [ ] §VI — расширить таблицу failure states (`BOUNDED_MODE` как подрежим внутри других состояний).
- [ ] §X — переименовать/расширить в «State Layout, Replay & Snapshots»; добавить полный перечень namespace из §4 этого документа.
- [ ] Новая глава или §III.4 — `STATE_ROOT_V1` domain tag + алгоритм.
- [ ] §XV — упоминание Flat Validation Fee и Dynamic Gas как обязательных PTRA-расходов.
- [ ] §XVI — упоминание compatibility window и `#pragma compatibility_mode`.
- [ ] Дата редакции 2026-05-23; запись в changelog raid.

---

## 8. Чек-лист содержимого CAL Execution Spec v0.1.0-draft

§1 Status & Scope · §2 CAL Structure (actions, taxonomy, post_conditions) · §3 Lifecycle State Machine · §4 Validator Role · §5 Receipts · §6 Concurrency & Nonce Discipline · §7 Event Reducer & State Root · §8 Signing Model (operator/owner, `OWNER_REQUIRED_ACTIONS`) · §9 Gas Model · §10 Bounded Mode · §11 Backwards Compatibility · §12 Examples · §13 Security Considerations · §14 License (MIT).

---

## 9. Чек-лист содержимого DSL Specification v0.1.0-draft

§1 Status & Scope · §2 Type System (наследует DSL v1.1) · §3 Operators (наследует) · §4 Post-conditions (`state.before`, `state.after`) · §5 Action Reference (registered taxonomy) · §6 Capability Gates · §7 Emergency Invariants (Bounded Mode) · §8 Hashing & Versioning · §9 Examples · §10 License (MIT).

---

## 10. Открытые вопросы для следующей итерации

- Точное численное значение `Flat_Validation_Fee` и формула `Dynamic Gas` per DSL op — требуется bench-данные после реализации `@paradigm-terra/canonical`.
- Whitelist `BOUNDED_MODE_ACTIONS` — нуждается в Tier 2 amendable списке.
- `OWNER_REQUIRED_ACTIONS` — стартовый список (предлагается: `capability.update`, `treasury.transfer`, `governance.vote_as_agent`, `ptra.stake`, `ptra.unstake`).
- Состав `epoch` (длина в тиках, что именно с ним связывать) — требуется решение перед Conformance Freeze.

---

## 11. Статус эталонной реализации и parity-верификация

**Дата:** 2026-05-24.

Эталонный пакет `@paradigm-terra/canonical` (TypeScript) реализует Canonical Encoding v1.3 (Consensus-Freeze) с расширениями v0.10.0-draft (`STATE_ROOT_V1`, `DSL_V1.2`) и публикует 17 golden-векторов (`canonical/vectors/golden.json`).

Проведена **parity-верификация** двумя независимыми реализациями:

- **Rust** — `paradigm_terra/canonical-rs/` (крейт `paradigm-terra-canonical`).
- **Go** — `paradigm_terra/canonical-go/` (модуль `github.com/paradigm-terra/canonical-go`).

Каждая независимо пересчитывает все 17 векторов — **44 пофайловых сравнения** на реализацию (integers, UTF-8 NFC, TON-адрес, restricted JCS, DSL v1.1/v1.2, CAL-hash, stream-tree и binary Merkle, genesis state root, framing, реестр domain-тегов) — и совпадает с эталоном байт-в-байт.

**Решение:** golden-векторы повышены из `PRE-NORMATIVE` в **`NORMATIVE`** — условие промоушена («Promote to NORMATIVE after parity verification with Rust and Go») выполнено.

**Затрагивает:**
- `→ CE §10.2 (Golden Vectors)` — статус NORMATIVE.
- `canonical/vectors/golden.json` — `meta.status`.

**Дифф-фаззинг трёх реализаций (выполнено 2026-05-24).**

Дифференциальный фаззер (`fuzz/driver.mjs`) и два полносводных свипа по всему пространству Unicode (`fuzz/ccc_sweep.mjs`, `fuzz/nfc_sweep.mjs`) прогнали идентичные входы через TS / Rust / Go и сверили **и** accept/reject, **и** выходные байты по всем примитивам. Обнаружены и устранены два класса расхождений:

1. **U+FEFF (BOM).** Поведение для ведущего U+FEFF зависело от позиции/числа ключей (TS/Rust бросали из компаратора сортировки ключей; Go принимал). Зафиксировано **строгое** правило (CE §3.2/§4.2): любой строковый токен JSON (ключ или значение), **начинающийся** с U+FEFF → `UTF8_BOM_FORBIDDEN`; U+FEFF в середине строки (ZWNBSP) допустим. Проверка вынесена в путь сериализации строк (единая точка для ключей и значений), компараторы сортировки сделаны чистыми (только порядок).

2. **Версия Unicode для NFC.** NFC‑бэкенды используют разные версии: Go `x/text` — **15.0** (на Go 1.26; build‑tag `!go1.27`), Node ICU 78 и Rust `unicode-normalization` 0.1.25 — **17.0**. Это давало расхождение канонического переупорядочивания для **46 комбинирующих знаков**, назначенных в 15.1/16.0/17.0 (диапазоны `U+0897`, `U+1ACF..U+1AEB`, `U+10D69..U+10D6D`, `U+10EFA..U+10EFB`, `U+113CE..U+113D0`, `U+1612F`, `U+1E5EE..U+1E5EF`, `U+1E6E3..U+1E6F5`). Расхождений уровня декомпозиции — **0**. Устранено **ограничением домена** (CE §3.2): каноническая строка обязана содержать только кодовые точки, назначенные по состоянию на Unicode 15.1; «слишком новые» отклоняются как `UTF8_UNASSIGNED_CODEPOINT`. По Unicode Normalization Stability Policy для принятых строк NFC побайтово идентичен во всех трёх бэкендах без их замены. Таблица назначенных диапазонов сгенерирована из UCD 15.1.0 `DerivedAge.txt` (`tools/gen_assigned.mjs`) и встроена идентично во все три реализации (`sha256(ranges)=59cb760256e1b8ec76aa6718a574b0e29a263fb37645bed358a137004c56a6d6`, 715 диапазонов).

**Результат:** на финальном прогоне — **0 расхождений** на 170 000 случайных входов (два all‑ops сида + jcs‑стресс) и на двух полносводных свипах по всему Unicode (1.1M одиночных + 1.1M×2 ccc‑пар). Golden‑векторы не затронуты (9 не‑ASCII скаляров, все назначены ≤15.1). TS 65/65, Rust и Go тесты — зелёные.

**Реестр §7.1 (Tier 2 amendment).** Зарегистрированы `STATE_ROOT_V1`, `DSL_V1.2` и консолидированы теги §3.5 (`JETTON_TRANSFER_V1`, `PTRA_STAKE/UNSTAKE/BURN_V1`) и §VI (`MCP_V1`).

**Оба условия Conformance Freeze выполнены** (регистрация тегов + дифф‑фаззинг). **Промоушен выполнен 2026-05-24:** CE v1.3 SCF → **Consensus‑Freeze**.

---

## 12. Лицензия

Документ распространяется под лицензией MIT (см. `LICENSE` в корне репозитория), как и все сопутствующие спецификации.
