# Анализ спецификаций Paradigm Terra и предложения по улучшению

**Дата анализа:** 2026-05-22  
**Обновлено:** 2026-05-24 (golden vectors реализованы и зафиксированы как NORMATIVE)  
**Проверенные документы:** Конституция v0.9.5, Execution Spec v1, Canonical Encoding v1.3 (Consensus-Freeze), Constraint DSL v1.1  
**Изученные внешние источники:** Cocoon, Acton, @ton/mcp, TON AI docs, agents.ton.org

---

## 1. Критические несоответствия (блокеры для перехода к Consensus Freeze)

### 1.1. Developer Fund — нарушение собственного канонического стандарта

**Проблема:** Конституция (Глава VIII) содержит:
```
Адрес Developer Fund: UQDoeX0ZfMAmGWirgHK2q_QQhdh4A9bT8-vbiMPR6pCQz1T5
```
Это **user-friendly base64 формат** (bounceable). Canonical Encoding v1.3 §3.3 и Конституция Глава III §3.1 **явно запрещают** этот формат, требуя `workchain:hex256`.

**Исправление:** заменить на канонический raw формат:
```
Адрес Developer Fund: 0:<hex256-эквивалент>
```
Нужно декодировать адрес и записать как `0:...`.

---

### 1.2. Golden vectors — заглушки вместо реальных значений

**Проблема:** Canonical Encoding §10.2 содержит явно ненастоящие хеши-заглушки:
```
0x3a6eb0790f39cc87d4e1b3f1a6b6f3e7d9c2b5a0f1e2d3c4b5a6f7e8d9c0b1a2f3
```
Длина — 65 hex символов (должно быть 64 = 32 байта). Это **структурная ошибка**.

**Исправление:**
1. Реализовать `@paradigm-terra/canonical` на Node.js и вычислить реальные хеши.
2. Отдельно зафиксировать: для `int256(-1)` ожидаемое каноническое представление — это хеш *от* байтов `0xff...ff`, а не сами байты.
3. Исправить пример с `int256(-1)`: в таблице показан `0xffff...ff` (raw bytes), а не SHA256-хеш.

---

### 1.3. CAL preconditions: JSON AST vs. natural language strings

**Проблема:** Execution Spec §6.1 (CAL Schema) показывает preconditions в виде строк на естественном языке:
```json
"preconditions": {
  "capability": "max_transfer_per_tick >= amount",
  "failure_state": "NORMAL"
}
```
Но Конституция (Глава I, §17) требует: «Предусловия (preconditions) должны быть верифицируемы **машиной**, не на естественном языке», а Constraint DSL v1.1 определяет формат JSON AST.

**Исправление:** CAL Schema должна использовать DSL-выражения:
```json
"preconditions": [
  {"dsl_version": "1.1", "expr": {"op": "gte", "lhs": {"var": "state.capability.max_transfer_per_tick"}, "rhs": {"var": "params.amount"}}},
  {"dsl_version": "1.1", "expr": {"op": "eq", "lhs": {"var": "state.failure_mode"}, "rhs": {"const": "NORMAL"}}}
]
```

---

### 1.4. MCP schema hash не задан — ✅ закрыто нормативно (2026-05-29)

**Было:** Конституция (Глава XI) говорила: «ожидаемый хеш схемы MCP зафиксирован в конституции», но нигде его не указывала. `MCP_DEGRADED_MODE` проверял этот хеш — без него триггер деградации был неопределён.

**Закрытие (Patchset A1):**
- **CAL Execution Spec §4.4.1** — нормативная формула: хеш считается **только от лексикографически отсортированного множества имён инструментов** (без descriptions/params, чтобы документационные правки upstream не инвалидировали хеш).
  ```
  MCP_SCHEMA_V1_TOOLSET := canonical_json(sorted_lex(tool_names))
  MCP_SCHEMA_HASH       := SHA256("PARADIGM_TERRA_MCP_V1" || MCP_SCHEMA_V1_TOOLSET)
  ```
- **CAL Execution Spec §4.4.2** — pinned toolchain: `@ton/mcp@0.1.15-alpha.16`. Конкретный байтовый хеш фиксируется первым прогоном референсного валидатора и входит в его golden vectors.
- **Constitution §6.bis** — ссылается на CAL Spec §4.4.1/§4.4.2 как нормативный источник формулы и pin'а; pin/patch/minor/major политика остаётся в §6.bis.

---

### 1.5. CONSENSUS_UNCERTAINTY — нет процедуры выхода

**Проблема:** Таблица Failure States (Конституция Глава VI) описывает вход в `CONSENSUS_UNCERTAINTY` (расхождение реплея >2 блоков), но **не определяет** условия выхода из него. В отличие от `MCP_DEGRADED_MODE` (есть автоматическое восстановление) и `PANIC_HALT` (явно: только через Tier 3).

**Исправление:** Добавить:
```
CONSENSUS_UNCERTAINTY → NORMAL: консенсус реплея восстановлен + 100 успешных последовательных событий без расхождений + явное подтверждение ≥3 независимых валидаторов.
```

---

## 2. Архитектурные проблемы

### 2.1. Определение «тика» (tick) не задано

Спецификации используют «тик» как единицу времени (30 тиков, 100 тиков, 1000 тиков и т.д.), но нигде не определяют:
- Сколько реальных секунд/блоков = 1 тик?
- Кто является источником времени для тика (блок TON, блокчейн lt, внешний оракул)?
- Как обрабатывается пропуск тиков (TON сеть может не производить блок каждые N секунд)?

**Предложение:** Добавить в Execution Spec новый раздел «Модель времени»:
```
TICK_DURATION = 5 секунд (1 блок TON mainnet ≈ 5 с)
TICK_SOURCE = blockchain_lt (детерминированно из цепочки блоков)
```

---

### 2.2. allowed_mcp_methods — ✅ сверено с @ton/mcp@alpha

Конституция §5.1 задаёт дефолт `allowed_mcp_methods = ["get_wallet","get_balance","send_ton","get_transactions","get_transaction_status"]` (5 методов).

**Сверка (2026-05-24, `@ton/mcp@alpha` = `0.1.15-alpha.16`):** все 5 дефолтных имён присутствуют в реальном API. Расхождений имён нет. Реальный пакет экспортирует 40 инструментов; конституция намеренно разрешает консервативное подмножество.

| Метод по умолчанию | Есть в @ton/mcp | Тип |
|---|---|---|
| `get_wallet` | ✅ | read-only |
| `get_balance` | ✅ | read-only |
| `get_transactions` | ✅ | read-only |
| `get_transaction_status` | ✅ | read-only |
| `send_ton` | ✅ | mutating |

**Остаточная рекомендация (не блокер):** в реальном API мутирующие методы (`send_ton`, `send_jetton`, `send_nft`, `send_raw_transaction`, `set_active_wallet`, `remove_wallet`, `agentic_*`) чётко отделимы от read-only (`get_*`, `resolve_dns`, `emulate_transaction`). Стоит зафиксировать эту типизацию в Главе V, чтобы профиль безопасности явно различал read-only и mutating capabilities при выдаче allowlist.

---

### 2.3. seqno gap при реплее не обработан

Execution Spec §5 требует строго монотонного `seqno` (+1 в потоке), но не говорит что делать при **пропуске** (seqno 5 → 7, нет 6). Должно ли это быть `CONSENSUS_UNCERTAINTY` или просто ошибкой валидации текущего события?

**Предложение:** явно добавить в §5: «Обнаружение gap seqno > 1 внутри потока → немедленный переход в `CONSENSUS_UNCERTAINTY`».

---

### 2.4. Receipt chain — поле `prev_receipt_hash` отсутствует в схеме

Execution Spec §6.3 упоминает: «Receipt chain: каждый receipt содержит `prev_receipt_hash`», но само поле **отсутствует** в JSON-схеме receipt.

**Исправление:** добавить в схему:
```json
"prev_receipt_hash": "0x..."  // 0x000...000 для первого receipt агента
```

---

### 2.5. Cartel Guard: определение «скоррелированного кластера» не формализовано

Конституция §7.3 упоминает «скоррелированный кластер» для Capture Guard, но не определяет критерии идентификации кластера (IP, stake source, on-chain паттерн, Sybil detection).

Без формального определения это неавтоматизируемый механизм — противоречит §17 Главы I («Предусловия должны быть верифицируемы машиной»).

---

## 3. Интеграционные возможности (использование изученных внешних ресурсов)

### 3.1. Cocoon → confidential_compute_allowed

Cocoon предоставляет:
- Intel TDX Confidential VMs с верифицируемыми аттестациями (RA-TLS)
- Децентрализованные оплаты через TON

**Рекомендации для протокола:**
- Добавить в CAL invariants опциональный флаг `require_confidential_compute: true`
- Добавить domain tag `"PARADIGM_TERRA_CONFIDENTIAL_V1"` для attestation receipts
- Определить `attestation_hash` в capability profile как обязательный при `confidential_compute_allowed = true`

### 3.2. Acton → смарт-контракты Paradigm Terra

Контракты протокола (Registry, FailureStateManager, Treasury) следует реализовывать через Acton с:
- `acton test` с trace inspection для детерминизм-тестов
- `acton verify` для верификации байткода (bytecode → source)
- Gas benchmark snapshots для регрессионного контроля

Референсные стандарты из [acton-contracts](https://github.com/ton-blockchain/acton-contracts):
- **NFT v1.1** — для governance NFT слотов (Judge, Sheriff и т.д.)
- **Wallet W5.2** — для Agentic Wallet base
- **Multisig v2.1** — для мультиподписных владельцев агентов

### 3.3. @ton/mcp + agents.ton.org → полный Agentic Wallet lifecycle

Текущая спецификация описывает Agentic Wallet абстрактно. Официальный стек:
- Деплой: `npx @ton/mcp@alpha` создаёт SBT в NFT-коллекции
- Мониторинг / ротация ключей: [agents.ton.org](https://agents.ton.org/)
- Split-key: owner (корневой кошелёк) + operator (ключ агента, приватный ключ только у агента)

**Рекомендация:** добавить в Конституцию Главу II явную ссылку на TEP (если он будет принят) для стандарта Agentic Wallet SBT.

### 3.4. Wallet V5 ↔ CAL isomorphism — ✅ зафиксировано (2026-05-29)

После анализа `/blockchain-basics/standard/wallets/v5` обнаружено, что Wallet V5 `ContractState` — это **строго изоморфная on-chain проекция** CAL authorization state, а не «похожая» структура:

| Wallet V5                                  | CAL                                  |
|--------------------------------------------|--------------------------------------|
| `wallet_id`                                | `agent_id`                           |
| `valid_until`                              | `expiration_tick`                    |
| `seqno` / `msg_seqno`                      | `nonce`                              |
| `public_key`                               | `operator_pubkey`                    |
| `is_signature_allowed`                     | root-signature enable bit            |
| `extensions_dict`                          | Bounded Mode whitelist (CAL §10.2)   |

**Закрытие (Patchset A2):** введено как нормативный §10 в `cal-validator-design.md`:
- `validator.operator_pubkey` **MUST** byte-match `Wallet V5 ContractState.public_key` (raw 32-byte Ed25519, user-friendly формы запрещены в любых hashed-полях);
- ротация ключа (`agentic_rotate_operator_key`) обязана обновлять on-chain и registry mirror в одном CAL;
- CAL Bounded Mode формально объявлен off-chain аналогом `is_signature_allowed = 0` + extension-gated execution.

Следствие: будущий TON Connect transport (Execution §8) укладывается на этот изоморфизм без новых сущностей — owner-signed CAL ↦ `signMessage`, validated CAL ↦ W5 external body.

### 3.5. TON Connect ingress для owner-подписей — ✅ зафиксировано (2026-05-29)

Дыра в Execution Spec §8: запрет на «прямые вызовы TON API» (§8.2) не объяснял, как owner-подпись попадает в CAL. Без явного канала ingress'а split-key модель из Agentic Wallets была дырявой с точки зрения транспорта.

**Закрытие (Patchset B):**
- **Execution Spec §8.3** — `signMessage` TON Connect v2 как единственный нормативный канал для `owner_sig`; carve-out в §8.2 (TON Connect — это wallet-side signing-protocol, не TON API call).
- **Execution Spec §8.3 / `ton_proof`** — domain-binding кошелька к origin'у (по умолчанию `agents.ton.org`, Tier 1 amendable); сохраняется в `state.registry.agents[id].owner_proof_domain`. Валидатор проверяет `signatures.owner_sig.pubkey == owner_proof_domain.pubkey` byte-match.
- **Execution Spec §8.3 / replay model** — `TC.valid_until` ↔ CAL `expiration_tick` (привязано); TC `id` ↔ CAL `nonce` (независимы по назначению); никакая часть TC replay-state не входит в `STATE_ROOT`.
- **Execution Spec §8.3 / bridge** — HTTP bridge с NaCl `crypto_box` явно out of consensus.
- **CAL Spec §8.5** — нормативный pointer на Execution §8.3 для owner-channel; operator-sig остаётся runtime-internal; sponsor-sig — implementation-defined.
- **Design note `ton-connect-ingress-design.md`** — полный technical depth (sequence, `ton_proof` flow, payload format, replay alignment table, multi-owner/HW-кошельки, out-of-scope).

**Отложено в этом patchset'е** (намеренно):
- `sendTransaction(W5 external)` для финальной on-chain публикации валидированного CAL — требует on-chain Registry-контракта и кодека `canonical_to_inner` (Annex F CAL Spec). Описано в §6 design note как future work, привязано к Registry roadmap.

---

## 4. Мелкие технические замечания

| № | Файл | Проблема | Предложение |
|---|------|----------|-------------|
| 4.1 | DSL v1.1 §3.2 | `and`/`or` — «полное вычисление без short-circuit, если любой ERROR → ERROR». Противоречит интуиции: `and(false, ERROR)` должно быть `false`, а не `ERROR`. | Уточнить семантику: `and` с `ERROR` → `ERROR` только если не обнаружен ранний `false`. Либо явно выбрать strict semantics и задокументировать. |
| 4.2 | Execution Spec §3.1 | `contract_address: "EQ..."` — base64 user-friendly формат в примере схемы. | Заменить на `"0:..."` для консистентности с Canonical Encoding. |
| 4.3 | Execution Spec §4.2 | `global_merkle_root` использует `hash(stream.state_hash)`, но `LEAF_HASH` формула уже содержит `state_hash_bytes` без доп. хеширования. Двойное хеширование? | Унифицировать: либо `state_hash_bytes` передаётся как raw в LEAF_HASH, либо явно хешируется. |
| 4.4 | Constitution §7.2 | `EffectiveVotePower = sqrt(SlotPrice) * JurisdictionAlignment * (1/ClusterAffinity)` — `ClusterAffinity` не определён как тип и не имеет нижней границы (деление на 0). | Добавить: `ClusterAffinity ∈ [0.1, 1.0]`, формально определить. |
| 4.5 | Canonical Encoding §5.1 | «Упорядочить явные пользовательские ссылки по хешу» — не указано, как поступать с ссылками, имеющими **одинаковый хеш** (теоретически возможно при collision). | Добавить тайbraker: при равных хешах — по исходному порядку (stable sort). |
| 4.6 | DSL v1.1 §3.4 | Путь `state.<namespace>.<path>` определён, но не указана максимальная глубина пути. С учётом лимита глубины AST=10 путь может быть сколь угодно глубоким. | Добавить лимит: максимум 5 сегментов в пути переменной. |

---

## 5. Приоритизированный план доработок

| Приоритет | Задача | Статус |
|-----------|--------|--------|
| P0 (блокер) | Исправить адрес Developer Fund → canonical raw format | ✅ Исправлено: `0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf` |
| P0 (блокер) | Исправить CAL preconditions → использовать DSL JSON AST | ✅ Исправлено: полная DSL-схема с `op`/`lhs`/`rhs` вместо строк |
| P0 (блокер) | Вычислить реальные golden vectors (убрать заглушки) | ✅ Реализован `@paradigm-terra/canonical`; golden.json — NORMATIVE, паритет TS/Rust/Go подтверждён (diff-fuzz clean) |
| P1 (критично) | Зафиксировать MCP schema hash в конституции | ✅ Закрыто нормативно (2026-05-29, Patchset A1): CAL Spec §4.4.1/§4.4.2 — formula names-only/lex-sorted + pinned `@ton/mcp@0.1.15-alpha.16`; Constitution §6.bis ссылается на §4.4 |
| Architectural | Wallet V5 ↔ CAL isomorphism (структурное соответствие, не аналогия) | ✅ Закрыто нормативно (2026-05-29, Patchset A2): `cal-validator-design.md` §10 — mapping table + MUST-level операторный pubkey byte-match + Bounded Mode ≡ `is_signature_allowed=0` |
| Architectural | TON Connect ingress для owner-подписей (entire trust ingress) | ✅ Закрыто нормативно (2026-05-29, Patchset B): Execution Spec §8.3 + CAL Spec §8.5 + design note `ton-connect-ingress-design.md`. `sendTransaction` (W5 external publication) отложен до on-chain Registry. |
| P1 (критично) | Определить процедуру выхода из CONSENSUS_UNCERTAINTY | ✅ Добавлена таблица условий восстановления для всех failure states |
| P1 (критично) | Добавить `prev_receipt_hash` в receipt schema | ✅ Добавлено поле + genesis-значение (32 нулевых байта) |
| P2 (важно) | Формально определить «тик» (Модель времени) | ✅ Новая Глава XII (5 с = 1 тик, источник: TON lt) |
| P2 (важно) | Синхронизировать allowed_mcp_methods с @ton/mcp schema | ✅ Сверено с `@ton/mcp@alpha` 0.1.15-alpha.16: все 5 дефолтных методов валидны, расхождений нет |
| P2 (важно) | Обработать seqno gap в Replay Engine | ✅ Добавлен: seqno gap → CONSENSUS_UNCERTAINTY |
| P3 (улучшение) | Формализовать кластер для Capture Guard | ✅ Добавлено детерминированное on-chain определение кластера (3 критерия) |
| P3 (улучшение) | Унифицировать примеры адресов (убрать base64 из схем) | ✅ `EQ...` → `0:<64 hex>` во всех схемах |
| P3 (улучшение) | Интегрировать Cocoon attestation в CAL invariants | ✅ Задокументировано в SIMULATION_PREVIEW.md |
| ✨ Новое | Многоязычность (11 языков, RTL, governance `summary_en`) | ✅ Добавлено во все 4 документа + новая Глава XIII |
| ✨ Новое | Лимит глубины пути переменной в DSL | ✅ Добавлено: max 5 сегментов → PARSE_ERROR |

---

## 6. Ссылки

Все внешние ресурсы: [LINKS.md](./LINKS.md)
