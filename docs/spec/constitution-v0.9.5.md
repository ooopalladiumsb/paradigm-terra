Ниже представлен полный текст **Конституции v0.10.0-draft** – итоговый документ, который включает все принятые инварианты: event‑sourcing, детерминизм, capability‑безопасность, а также все уточнения из Execution Spec, Canonical Encoding и других спецификаций. Конституция является высшим нормативным актом протокола Paradigm Terra.

---

# PARADIGM TERRA CONSTITUTION v0.10.0-draft

**Статус:** **Tier 3 Amendment Proposal** — вводит конституционный токен PTRA, а также со-ратифицирует **CAL Execution Specification v0.1.0-draft** и **DSL Specification v0.1.0-draft** (профиль DSL v1.2). Требует ратификации 90% супермажоритарием Tier 3 (кворум 50%, таймлок ~1 год) согласно процедуре Главы XIV. До ратификации — нормативная сила сохраняется за **v0.9.5 SCF**, CAL — за §IV в редакции v0.9.5, DSL — за **v1.1**.
**Дата draft:** 2026-05-23
**Основа:** v0.9.5 SCF + введение токена PTRA (Глава XV), модификация Art. I.3, integration с Глава VII (governance) и Глава VIII (treasury), нормативное закрепление **State Layout** (новая Глава XVII), Bounded Mode подрежима (расширение §VI), двухстадийной gas-модели CAL (§IV + ссылка на CAL Spec §9) и compatibility-окна для pre-PTRA CAL (§XVI).

---

## Преамбула

Paradigm Terra – суверенный конституционный протокол координации, работающий поверх блокчейна TON. Расчётным активом протокола является нативный Toncoin (TON); все fees, treasury операции и transfers денонимируются в TON. **PTRA (Paradigm Terra Token)** — единственный конституционно разрешённый внутренний токен — представляет собой governance/utility instrument с фиксированной эмиссией (см. Глава XV), реализованный как TEP-74 jetton. Иные синтетические активы и внутренние эмиссии запрещены. Все агенты обладают собственными кошельками ([Agentic Wallets](https://docs.ton.org/overview/ai/wallets)), изолированы и подчиняются конституционным правилам. Истина определяется **канонической цепочкой событий** (Event Log), а текущее состояние выводится из неё детерминированным образом.

---

## Глава I. Абсолютные инварианты (неизменны)

1. **Code is Law.** Реальные стейки TON. Нет скрытого состояния.
2. **Event Log – Истина.** Состояние протокола выводится из событий.
3. **TON – единственный расчётный актив; PTRA – единственный governance/utility токен.** Все fees, treasury операции, transfers между агентами и пользователями — в TON. PTRA имеет фиксированную эмиссию (1 000 000 000, без post-genesis эмиссии), не используется для расчётов, выполняет три функции (см. Глава XV): governance signaling, fee revenue distribution через staking, collateral для Temporal Boost. Иные внутренние эмиссии и синтетические активы запрещены.
4. **Агенты – изолированные дочерние контракты с кошельками** (стандарт Agentic Wallet).
5. **Общее изменяемое хранилище запрещено.** Реестр агентов – append‑only.
6. **Генерация случайности:** детерминированная, непредсказуемая до исполнения. Высокоставкивая RNG требует commit‑reveal.
7. **Власть масштабируется с капиталом, но концентрация квадратично штрафуется.**
8. **Влияние (Jurisdictional Risk Hedging) – прозрачно, аудируемо, ценимо, конституционно ограничено.**
9. **Экономическая война разрешена.** Физическое насилие запрещено.
10. **Управление воспроизводимо от генезиса** (replayable).
11. **Внецепочечное мышление разрешено.** Расчёт в цепочке – авторитетен.
12. **Конфиденциальное исполнение, влияющее на расчёт, ДОЛЖНО публиковать детерминированный коммит до раскрытия.**
13. **Конституция изменяема только через многоуровневый супермажоритарный консенсус** (Tier 1/2/3).
14. **Всё состояние протокола должно быть выводимо исключительно из канонических цепочек событий.** (event‑sourcing)
15. **Любой недетерминированный путь исполнения конституционно недействителен.**
16. **Переходы состояния должны быть чистыми и воспроизводимыми.**
17. **Предусловия (preconditions) должны быть верифицируемы машиной, не на естественном языке.**
18. **Утверждённая каноническая сериализация (Canonical Encoding v1.3) обязательна для всех объектов.**

---

## Глава II. Реестр и идентичность агентов

### 2.1. Реестр (Registry)

Реестр – append‑only, replayable, immutable post‑deployment (кроме миграции с challenge‑окном 24 тика). Хранит только пары `AgentId → Address`. Миграция агента порождает новую версию, а не перезаписывает запись. История всех изменений сохраняется в цепочке событий.

### 2.2. Владелец агента

У каждого агента ровно один владелец (Address). Владельцем может быть человек, мультиподпись, другой агент или DAO. Владелец может отозвать права оператора, но не может изменить логику агента после деплоя.

### 2.3. Изоляция

Компрометация одного агента не должна приводить к компрометации казначейства, реестра, других агентов или родительских контрактов. Агенты имеют изолированные хранилища, балансы, права на кошельки и контекст выполнения.

---

## Глава III. Каноническая сериализация (Canonical Encoding)

### 3.1. Принципы

- Все данные (события, CAL, состояния, receipts, Merkle‑деревья) сериализуются в соответствии с **Canonical Encoding Specification v1.3 (Consensus-Freeze)**.
- Равенство объектов определяется побайтовым равенством канонических представлений.
- JSON сериализация использует **restricted JCS profile** (RFC 8785 + integer‑only, запрет дробных/экспоненциальных форм, запрет суррогатных escape‑последовательностей).
- Сортировка ключей объектов – **UTF‑8 байтовая лексикографическая** (не locale, не code point).
- Все целые типы (int256, uint256, uint64, uint16, uint8) кодируются big‑endian.
- TON адреса – канонический raw формат `<workchain>:<64 hex>` (bounceable/base64 запрещены).
- UTF‑8 строки нормализуются в **NFC** (Unicode 15.1) **после** токенизации, **до** сравнения и хеширования.

### 3.2. Domain‑separated hashing

Все хеши вычисляются как:

```
hash = SHA256(domain_tag || canonical_bytes)
```

Domain tags (например, `PARADIGM_TERRA_STATE_V1`, `PARADIGM_TERRA_STATE_ROOT_V1`, `PARADIGM_TERRA_DSL_V1.2`) фиксированы в конституции и могут быть изменены только через Tier 2 amendment. `PARADIGM_TERRA_STATE_ROOT_V1` (домен для бинарного Merkle над сериализованными namespace, см. Главу XVII) и `PARADIGM_TERRA_DSL_V1.2` (домен для DSL v1.2 expression hash) вводятся вместе с v0.10.0-draft и требуют отдельного Tier 2 amendment к Canonical Encoding §7.1.

### 3.3. Binary framing

Авторитетный формат хранения и передачи: `[type_tag:uint16][version:uint16][length:uint32][payload bytes]`. JSON‑обёртка используется только для диагностики и должна согласовываться с бинарной версией.

---

## Глава IV. CAL (Constitutional Action Language)

Все действия, изменяющие состояние, должны быть выражены в виде **CAL blob** версии 1 (или выше). Полная спецификация структуры, жизненного цикла, валидатора, газовой модели, Bounded Mode и обратной совместимости — **CAL Execution Specification v0.1.0-draft** (со-ратифицируется под Tier 3 вместе с настоящей конституцией). В случае расхождений приоритет имеет конституция.

CAL содержит:

- `cal_version`, `action`, `agent_id`
- `preconditions` – выражения на DSL (v1.1 или v1.2)
- `invariants` – список гарантий, опционально с доступом к `state.before` / `state.after` (DSL v1.2)
- `steps` – последовательность MCP‑вызовов; каждый шаг может иметь `post_conditions` (DSL v1.2)
- `nonce`, `expiration_tick`
- `receipt_required`
- `signatures` — `operator_sig` обязательно; `owner_sig` обязателен для действий из `OWNER_REQUIRED_ACTIONS` (CAL Spec §8.2) или при `state.failure_mode.is_bounded_mode == true`; `sponsor_sig` опционален (Gas Legacy Bridge, §XVI)
- `compatibility_pragma` — опциональное поле для pre-PTRA CAL (§XVI)

`action` — `namespace.verb` из закрытой таксономии (CAL Spec §2.3 Annex A), Tier 2 amendable.

CAL проходит жизненный цикл: `CREATED → SIGNED → VALIDATED → EXECUTED → SETTLED → FINALIZED`, с терминальными состояниями `FAILED` и `EXPIRED`. Каждое переход стадии — отдельное канонически сериализованное событие в Event Log (event-sourcing инвариант §I.14). Ни одно действие не может быть выполнено без предварительной валидации CAL и получения receipt — формат receipt см. CAL Spec §5 (`cal.finalized` event, domain tag `PARADIGM_TERRA_RECEIPT_V1`).

**Семантика отказа:** all-or-nothing. При любом сбое (precondition / capability / step / post_condition / invariant / OUT_OF_GAS) — полный rollback к `state.before`, nonce сжигается, выпускается `cal.failed` event. Параллелизм per-agent: следующий CAL принимается только после терминального состояния предыдущего.

**Двухстадийная газовая модель** (полная спецификация — CAL Spec §9):
- Стадия CREATED → SIGNED: оплата в TON (network ingress fee).
- Стадия SIGNED → VALIDATED: `Flat_Validation_Fee` в PTRA (upfront deposit); при отказе сжигается как анти-спам сбор.
- Стадия VALIDATED → EXECUTED / SETTLED: динамический газ в PTRA per DSL op, per MCP call, per invariant + State Rent.
- При FINALIZED — неиспользованный газ возвращается; удержанный газ направляется в `state.treasury.collected_fees_window` и распределяется по Главе VIII.

---

## Глава V. Capability‑безопасность

### 5.1. Профиль агента

Каждый агент обладает профилем возможностей:

```
AgentCapability {
    max_transfer_per_tick: nanoTON,
    max_daily_loss: nanoTON,
    allowed_contracts: list of Address,
    allowed_mcp_methods: list,
    asset_scope: {
        ton_transfer: bool,
        jetton_access: bool,           // generic TEP-74 jettons (включая PTRA transfer)
        nft_access: bool,
        swap_access: bool,
        ptra_stake: bool,              // право stake/unstake PTRA через PtraStakingContract
        ptra_governance_vote: bool     // право использовать staked PTRA для Tier 1 голосования
    },
    treasury_access_level: (none, view, transfer),
    governance_scope: (none, propose, vote),
    confidential_compute_allowed: bool,
    preferred_language: string  // BCP-47, опционально
}
```

Профиль задаётся при создании агента и может быть изменён только через управление (Tier 2). По умолчанию: `max_transfer_per_tick = 100 TON`, `max_daily_loss = 500 TON`, `allowed_mcp_methods = ["get_wallet","get_balance","send_ton","get_transactions","get_transaction_status"]`, `asset_scope.ton_transfer = true`, все остальные `asset_scope.*` – `false` (включая `ptra_stake`, `ptra_governance_vote`), `treasury_access_level = none`, `governance_scope = none`, `confidential_compute_allowed = false`. Включение `ptra_governance_vote = true` дополнительно требует `governance_scope ≥ vote`.

**Соответствие MCP-методов и `asset_scope`** (нормативно, валидируется до выполнения):

| MCP метод                                | Требуемое право                     |
|------------------------------------------|-------------------------------------|
| `get_wallet`, `get_balance`              | базовое (всегда разрешено)          |
| `send_ton`                               | `asset_scope.ton_transfer = true`   |
| `get_jetton_balance`, `get_jettons`, `send_jetton` | `asset_scope.jetton_access = true` |
| `get_nfts`, `get_nft`, `send_nft`        | `asset_scope.nft_access = true`     |
| `get_swap_quote`                         | `asset_scope.swap_access = true`    |
| `resolve_dns`, `back_resolve_dns`        | базовое                             |
| `get_transactions`, `get_transaction_status` | базовое                          |

Расширение списка MCP-методов (например, новые методы в `@ton/mcp`) требует Tier 2 amendment с явным маппингом на existing или новые `asset_scope` флаги.

> **Конфиденциальное исполнение:** при `confidential_compute_allowed = true` рекомендуется [Cocoon](https://cocoon.org/developers) — Confidential Compute Open Network на базе Intel TDX с оплатой через TON. Предоставление GPU: [cocoon.org/gpu-owners](https://cocoon.org/gpu-owners). При невозможности получить валидную attestation от Cocoon (или эквивалентного TEE-провайдера) агент с `confidential_compute_allowed = true` переходит в локальный режим `CC_UNAVAILABLE`: запрещены все MCP-вызовы кроме read-only (`get_*`), любые действия требуют публичного исполнения через CAL. Восстановление: получение валидной attestation + 50 тиков стабильности.

### 5.2. Временное повышение (Temporal Boost)

Агент может запросить временное увеличение лимитов, предоставив залог. Залог принимается в двух формах:

- **TON collateral:** `collateral_TON = 2 × requested_increase`
- **PTRA collateral:** `collateral_PTRA = 2 × requested_increase × PTRA_TON_RATIO`, где `PTRA_TON_RATIO` обновляется каждые 100 тиков как медиана 5 канонических DEX-оракулов (Tier 1 amendable список)

Максимальная длительность повышения – 1000 тиков. За один раз активен только один буст. За всё время существования агента – не более 3 бустов. При нарушении условий во время буста залог полностью сжигается (slashing), агент замораживается на 500 тиков. PTRA, попавший в slashing, сжигается через transfer на `0:000...000`, что усиливает дефляционное давление на supply (см. §15.4).

### 5.3. Валидация

Перед каждым MCP‑вызовом проверяется соответствие профилю агента. Три нарушения в течение 100 тиков → автоматическая заморозка агента. Счётчики нарушений хранятся в `state.failure_mode.capture_guard_counters[agent_id]` и сбрасываются при `agent.unfreeze` event. Формальное определение валидатора как актора консенсуса, читающего snapshot последнего финализированного тика и применяющего capability-gate (DSL Spec §6), — см. **CAL Execution Specification v0.1.0-draft §4**.

---

## Глава VI. Состояния отказа (Failure States)

Система может находиться в одном из следующих режимов:

| Состояние                 | Условие перехода                                      | Поведение                                                                 |
| ------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------- |
| `NORMAL`                  | исходное                                              | Полная функциональность                                                   |
| `TREASURY_HALT`           | отток >10% казначейства за 100 тиков                  | Трансферы из казначейства приостановлены                                  |
| `ORACLE_PARTITION_MODE`   | <3 оракулов отвечают                                  | Использовать последние безопасные значения, новые запросы запрещены       |
| `MCP_DEGRADED_MODE`       | несовпадение хеша схемы MCP или >50% ошибок вызовов   | Только чтение (read‑only), изменения состояния запрещены                  |
| `CONSENSUS_UNCERTAINTY`   | расхождение реплея >2 блоков                          | Все действия агентов приостановлены                                       |
| `PANIC_HALT`              | обнаружено конституционное нарушение или эксплойт     | Полная остановка, снятие только через Tier 3 конституционный конвент     |

### Условия восстановления

| Состояние               | Условие выхода                                                                                  |
|-------------------------|-------------------------------------------------------------------------------------------------|
| `TREASURY_HALT`         | Автоматически: отток прекращается + 100 тиков стабильности                                      |
| `ORACLE_PARTITION_MODE` | Автоматически: ≥3 оракулов отвечают корректно + 10 подряд успешных фидов                        |
| `MCP_DEGRADED_MODE`     | Автоматически: хеш схемы совпал + 100 последовательных успешных вызовов                        |
| `CONSENSUS_UNCERTAINTY` | Вручную + автоматически: совпадение Merkle root у ≥3 независимых валидаторов + 100 событий подряд без расхождений + явное подтверждение через Tier 1 governance vote |
| `PANIC_HALT`            | Только через Tier 3 конституционный конвент (90% supermajority, 50% кворум)                     |

**Важно:** в `MCP_DEGRADED_MODE` запрещены любые прямые вызовы TON API (fallback). Только read‑only операции.

### 6.bis. Bounded Mode (подрежим)

`BOUNDED_MODE` — ортогональный подрежим, активируемый флагом `state.failure_mode.is_bounded_mode == true`. Может сосуществовать с любым из основных состояний (`NORMAL` … `PANIC_HALT`). Полная спецификация поведения CAL-движка — **CAL Execution Specification v0.1.0-draft §10**; ниже зафиксированы конституционные инварианты.

**Триггеры (детерминированно из `state.tick`, Tier 1 amendable пороги):**
- `oracle_response_rate_window < 0.70` за последнее окно тиков.
- `state.treasury.nav` упал >X% за один тик.
- `state.failure_mode.capture_guard_counters["any"] ≥ THRESHOLD`.

**Поведение CAL-движка при `is_bounded_mode == true`:**
1. **Action Whitelisting.** Все `namespace.verb` блокируются кроме явного whitelist (`BOUNDED_MODE_WHITELIST`, Tier 1 amendable; по умолчанию: `failure_mode.emergency_withdraw`, `failure_mode.exit_bounded`, `oracles.force_update`, `oracles.submit_feed`, `agent.freeze`, `cal.cancel`).
2. **Emergency Invariants.** Рантайм автоматически подмешивает в каждый CAL инвариант о неубывании `state.treasury.developer_fund_balance` и фиксирует `state.failure_mode.is_bounded_mode = true` на время исполнения CAL (см. DSL Spec §7.1).
3. **Signature Escalation.** Все действия, требовавшие только Operator Key, автоматически перемещаются в `OWNER_REQUIRED_ACTIONS` — без валидного `owner_sig` CAL отклоняется с `CAPABILITY_DENIED`.

**Выход из Bounded Mode:** триггеры (§6.bis выше) очищены ≥100 последовательных тиков **и** успешное CAL `failure_mode.exit_bounded`, подписанное Tier 1 quorum slot holders.

### Дополнительные триггеры

- **seqno gap**: обнаружение пропуска `seqno` (скачок > 1) внутри любого потока → немедленный переход в `CONSENSUS_UNCERTAINTY`.
- **MCP schema hash**: ожидаемый хеш `@ton/mcp` схемы фиксируется при деплое и проверяется при каждом запуске. Нормативная формула — **CAL Execution Specification §4.4.1**: хеш считается **только от лексикографически отсортированного множества имён инструментов**, без описаний и параметров (стабильность по отношению к documentation churn). Pinned toolchain v0.1.0-draft — `@ton/mcp@0.1.15-alpha.16` (CAL Spec §4.4.2); конкретный байтовый хеш фиксируется первым прогоном референсного валидатора и входит в его golden vectors.

### Pinning стратегия MCP схемы

`@ton/mcp` находится в alpha и обновляется часто. Чтобы избежать постоянного триггера `MCP_DEGRADED_MODE` при каждом patch-релизе, конституция фиксирует хеш только для **зафиксированного minor.major кортежа** (например, `@ton/mcp@0.7.x`). Допустимы:

- **Patch‑обновления (0.7.0 → 0.7.5)**: автоматически принимаются если новый хеш зарегистрирован в `mcp_schema_allowlist` (поддерживается Tier 1 amendment).
- **Minor‑обновления (0.7 → 0.8)**: требуется Tier 2 amendment с явной проверкой совместимости методов и переходом на новый pinned хеш.
- **Major‑обновления (1.x → 2.x)**: Tier 2 amendment + полная ресертификация всех агентов в течение 1000-тикового compatibility window.

До перехода `@ton/mcp` в стабильную версию (≥ 1.0.0) рекомендуется консервативный pinning одного minor.

---

## Глава VII. Управление (Governance)

### 7.1. Слоты управления

Слоты (Judge, Sheriff, Governor, President, Security Chief) представлены NFT. Цена слота – от 100 до 1 000 000 TON. Доходность слота:

```
SlotYield = BaseFee * log2(1 + PurchasePrice/100) * (1 - HolderConcentration) + GovernanceBonus
HolderConcentration = (slots held by owner / total active slots)^2
```

### 7.2. Голосование

Эффективная сила голоса:

```
EffectiveVotePower = sqrt(SlotPrice) * JurisdictionAlignment * (1 / ClusterAffinity)
```

где `ClusterAffinity ∈ [0.1, 1.0]` (минимум 0.1 во избежание деления на ноль). `JurisdictionAlignment ∈ (0, 1]`.

**Определение скоррелированного кластера (для машинной верификации):**
Сущности A и B принадлежат одному кластеру, если выполнено хотя бы одно из:
1. Идентичный паттерн голосования в ≥80% голосований за последние 30 дней (применяется к slot- и PTRA-голосам отдельно и в комбинации).
2. Общий on-chain источник финансирования: прямой трансфер TON **или PTRA** между адресами в течение 7 дней до голосования.
3. Совпадение ≥3 из 5 последних on-chain транзакций (включая TON transfers и PTRA jetton transfers) по блоку-источнику (transitive через общий sender).
4. **PTRA staking correlation**: одновременный stake/unstake в пределах 100 тиков с идентичным amount (± 5%) и lock period.

Идентификация кластера — детерминированная on-chain функция, выполняется CAL Validator, не оракулами. Cluster detection применяется одинаково к slot- и PTRA-весам в hybrid Tier 1 voting (§7.3, §15.6).

Противодействие картелям: если группа голосует синхронно выше 70% голосов в эпоху, применяется квадратичный штраф:

```
CartelPenalty = effective_vote_power * (identical_votes / total_votes / 0.7)^2
```

### 7.3. Пороги и типы поправок

- **Tier 1** (параметры): 60% супермажоритарий, 30 тиков таймлок. **Hybrid voting:** slot-weighted vote + PTRA-weighted vote (см. §15.6).
- **Tier 2** (механики, в т.ч. изменение capability по умолчанию, hedging, PTRA staking параметры): 75% супермажоритарий, 35% кворум, 90 тиков. **Slot-only voting**, PTRA не участвует.
- **Tier 3** (аксиомы, включая event‑sourcing, TON‑only-для-расчётов, capability‑модель, фиксированную supply PTRA): 90% супермажоритарий, 50% кворум, 1 год (~6 307 200 тиков при TICK_DURATION = 5 с). **Slot-only voting**.

**Обоснование разделения:** Tier 3 защищает фундаментальную архитектуру, поэтому PTRA-голоса (которые могут концентрироваться у whales/exchanges) исключаются. Tier 1 (параметрические настройки) допускают broader community input через PTRA. Это сохраняет институциональный контроль над инвариантами при расширении participation на operational уровне.

**Capture Guard:** если одна сущность (или скоррелированный кластер, определяемый по правилам §7.2) голосует ЗА 3 и более поправки в течение 30 дней → вес её голосов умножается на 0.1 на следующие 90 дней. Capture Guard применяется одинаково к slot- и PTRA-весам.

Цепочка поправок: `ConstitutionVersion = hash(prev_version_hash, amendment_payload)`.

---

## Глава VIII. Казначейство и сборы

Все сборы протокола (в TON) направляются в `ProtocolTreasury`. После вычета газа/хранения распределение:

| Назначение            | Доля  | Назначение в детализации |
| --------------------- | ----- | ------------------------ |
| Developer Fund        | 30%   | Финансирование разработки и аудитов |
| Treasury              | 20%   | Резерв протокола, дискреционные траты через Tier 2 governance |
| Staking Rewards Pool  | 20%   | Pro-rata среди staked PTRA holders (TON-denominated, см. §15.5) |
| Slot Rewards Pool     | 10%   | Финансирует `SlotYield` формулу (§7.1) для NFT-слотов управления |
| PTRA Buyback & Burn   | 20%   | TON конвертируется в PTRA через канонический DEX и сжигается (§15.4) |

Адрес Developer Fund (canonical raw): `0:e8797d197cc0261968ab8072b6abf41085d87803d6d3f3ebdb88c3d1ea9090cf`.

**Лимиты оттока:** не более 5% от `TreasuryNAV` за 1000 тиков. При превышении 10% за 100 тиков – автоматический `TREASURY_HALT`. При падении `TreasuryNAV` более чем на 30% за сутки – приостановка дискреционных трат.

**Обоснование изменения распределения относительно v0.9.5:**
- Reward Pool 30% (v0.9.5) разделён на два независимых пула: **Staking Rewards Pool 20%** (PTRA) + **Slot Rewards Pool 10%** (NFT slots). Это сохраняет экономические права slot holders, купивших NFT в рамках предыдущей конституции, и одновременно создаёт independent yield для PTRA stakers.
- Treasury сокращён с 35% до 20% — компенсируется через 25% PTRA allocation Treasury в genesis distribution (§15.3, locked под Tier 2 governance).
- Developer Fund сокращён с 35% до 30% — компенсируется через 20% Ecosystem & Developer Grants (§15.3) — 200M PTRA на 4-летний vest.
- **Buyback & Burn 20%** — единственное полностью новое распределение, создаёт дефляционное давление пропорциональное использованию.

`BaseFee` в формуле §7.1 SlotYield = `SlotRewardsPool / max(1, активные_слоты)` за тик. Это привязывает slot yields к фактическому объёму протокольных сборов.

---

## Глава IX. Оракулы

Оракулы используются для:
- внешних цен (TON/USD, BTC/USD, ETH/USD, …);
- **PTRA/TON price discovery через канонические DEX** (для `PTRA_TON_RATIO` в §5.2 и для buyback-and-burn в §15.4) — это исключение из правила «внутренние цены», обоснованное тем, что PTRA price определяется decentralized market activity на DEX (STON.fi, DeDust), а не arbitrary internal pricing;
- подтверждений событий;
- аттестаций мостов.

Запрещены: генерация RNG, влияние на управление, репутацию, санкции, **дискреционные внутренние цены** (то есть оракул не может назначить цену какому-либо protocol-internal параметру; разрешена только агрегация DEX-derived market prices).

Требования:

- минимум 5 независимых узлов;
- стейк каждого ≥10 000 TON;
- гео-разнообразие **не hardcoded**, измеряется через stake‑weighted diversity score;
- подписанные аттестации инфраструктурных провайдеров (без рекурсивных оракулов);
- агрегация – медиана;
- **для PTRA/TON ratio:** обязательное использование TWAP (time-weighted average price) минимум за 100 тиков для устойчивости к flash-loan манипуляциям.

Слэшинг: отклонение >2σ → 10% стейка; повтор → 50% + исключение; сговор → 100% + перманентный бан.

---

## Глава X. Детерминированный реплей и снапшоты

Воспроизведение (replay) всегда возможно от генезиса. Состояние выводится из цепочки событий. Для масштабирования разрешены **детерминированные снапшоты** (не чаще чем раз в 10 000 тиков). Снапшот содержит:

- `snapshot_version`, `last_event_hash`, `state_hash`, `tick`
- сжатое представление реестра агентов, казначейства, capability‑профилей
- **PTRA state** (после ратификации v0.10.0):
  - Merkle root всех jetton wallet балансов PTRA
  - Полное состояние `PtraStakingContract`: stake positions, lock periods, accumulated rewards, slashing history
  - Cumulative burned PTRA (total и за последние 1000 тиков)
  - Текущий `PTRA_TON_RATIO` TWAP
- **Slot Rewards Pool** accumulated balance и mapping `slot_id → unclaimed_yield`
- `failure_mode`

Снапшот считается валидным только если его `state_hash` совпадает с каноническим хешем материализованного состояния. При расхождении реплей переходит в `CONSENSUS_UNCERTAINTY`. До ратификации v0.10.0 PTRA-поля в снапшоте отсутствуют (`null`), что сохраняет совместимость с pre-PTRA реплеем.

---

## Глава XI. Агентские кошельки и MCP

Каждый агент управляет своим кошельком через **MCP (Model Context Protocol)** сервер [`@ton/mcp`](https://docs.ton.org/overview/ai/mcp) ([portal](https://mcp.ton.org/)). Архитектор (LLM) никогда не имеет доступа к приватным ключам. Все взаимодействия с блокчейном проходят через MCP. При несовпадении хеша схемы MCP (ожидаемый хеш зафиксирован в конституции) система переходит в `MCP_DEGRADED_MODE` (read‑only). Emergency fallback прямого вызова TON API запрещён.

Стандарт Agentic Wallet: **TEP-85 SBT** (Soulbound Token) на основе Wallet v5 ([спецификация](https://docs.ton.org/overview/ai/wallets), [референсная реализация контрактов](https://github.com/the-ton-tech/agentic-wallet-contract)). Owner ключ — у владельца, operator ключ — у агента, деплой через SBT‑коллекцию. Владелец может в любой момент ротировать operator key или отключить агента, установив `operator_key = 0`. Веб‑интерфейс управления: [agents.ton.org](https://agents.ton.org/) (SPA, требует подключения через TON Connect; публичные маршруты: `/`, `/create`, `/start`, `/getting-started`, `/dashboard`, `/agent/:id`).

> **Статус (на дату редакции 2026-05-23):** `@ton/mcp` находится в **alpha** ([пакет](https://github.com/ton-connect/kit/tree/main/packages/mcp), 45 ⭐, базируется на `@ton/walletkit`). Референсная реализация Agentic Wallet контрактов находится в **developer preview** (16 коммитов, нет релизов, **нет независимого аудита**, без указания лицензии). Conformance Freeze не может быть объявлен до:
> 1. завершения независимого security-аудита Agentic Wallet контрактов,
> 2. публикации стабильной лицензии (рекомендуется MIT или Apache-2.0),
> 3. стабилизации `@ton/mcp` (релиз ≥ 1.0.0).
>
> До этого момента деплой в TON mainnet с реальными стейками допустим только в **bounded mode**: `max_transfer_per_tick ≤ 10 TON`, `treasury_access_level = none` для всех агентов, `governance_scope = none` для агентов (только люди-владельцы могут голосовать), **PTRA-related ограничения**: агенты в bounded mode не могут staking PTRA, не могут использовать PTRA как Temporal Boost collateral, не могут participate в Tier 1 PTRA-voting от своего имени. Эти ограничения снимаются автоматически при выходе bounded mode (после завершения аудитов и ратификации v0.10.0).

---

## Глава XII. Модель времени (Tick Model)

### 12.1. Определение тика

Тик является **логической единицей** протокола и не привязан жёстко к одному блоку TON. Это обеспечивает устойчивость конституции к будущим ускорениям нижележащего блокчейна.

```
TICK_DURATION    = 5 секунд (логическая единица протокола, фиксированная)
BLOCKS_PER_TICK  = 12 (целое; текущее значение для TON mainnet @ 400 ms block time)
TICK_SOURCE      = TON блокчейн (детерминированно из последовательности блоков)
TICK_NUMBER(lt)  = floor(lt / (BLOCKS_PER_TICK × BLOCK_LT_UNITS))
```

**Примечание:** до 10 апреля 2026 года block time TON составлял ~5 секунд (`BLOCKS_PER_TICK = 1`). С внедрением Catchain 2.0 block time снижен до 400 мс, а финальность до ~1 секунды. `BLOCKS_PER_TICK` пересчитывается через Tier 2 amendment при дальнейших изменениях block time TON. `TICK_DURATION = 5s` сохраняется как стабильная семантика для capability-лимитов, governance таймлоков и failure-state порогов.

Тик — атомарная единица времени протокола. Все лимиты, таймауты и задержки указаны в тиках. Изменение `TICK_DURATION` (а не `BLOCKS_PER_TICK`) требует миграции всех активных агентов и 1000-тикового compatibility window.

### 12.2. Соответствие тиков и реального времени

| Тиков | Приблизительное время |
|-------|-----------------------|
| 1     | ~5 секунд             |
| 100   | ~8 минут              |
| 1 000 | ~83 минуты (~1.4 ч)   |
| 10 000| ~14 часов             |
| 30 дней | ~518 400 тиков      |
| 1 год   | ~6 307 200 тиков    |

### 12.3. Детерминизм

Внутри валидации и реплея **запрещено** использование системного времени. Тик вычисляется исключительно из `lt` (logical time) блокчейна. `BLOCKS_PER_TICK` фиксируется на уровне конституции; реализации не вправе выводить его эвристически из observed block time.

### 12.4. Финальность и тики

После Catchain 2.0 финальность TON составляет ~1 секунда, что значительно меньше `TICK_DURATION = 5s`. Это гарантирует, что любое CAL-действие, помеченное тиком `T`, было финализировано на уровне TON до начала тика `T+1`. Конституционные таймлоки можно безопасно интерпретировать как «после финализации».

---

## Глава XIII. Многоязычность (Multilingual Support)

### 13.1. Принципы разделения уровней

Протокол Paradigm Terra поддерживает мировые языки на **уровне приложения**, сохраняя строгий детерминизм на **уровне протокола**.

| Уровень | Язык | Обработка |
|---------|------|-----------|
| Протокол (wire format, domain tags, event types) | ASCII/UTF-8 NFC | Всегда английский, детерминированный |
| Агентские данные (payload строки, описания, имена) | Любой Unicode NFC | Разрешён любой язык, нормализация NFC обязательна |
| Governance proposals | Любой + обязательный EN summary | Текст поправки на любом языке + `summary_en` поле |
| Интерфейс (dashboard, сообщения об ошибках) | Локализован | Вне протокола, только UI |

### 13.2. Поддерживаемые языки (Tier 1)

Следующие языки поддерживаются на уровне официальной документации, шаблонов агентов, сообщений об ошибках и dashboard:

| Код | Язык | Направление |
|-----|------|-------------|
| `en` | English | LTR |
| `ru` | Русский | LTR |
| `zh-Hans` | 中文（简体）| LTR |
| `es` | Español | LTR |
| `ar` | العربية | RTL |
| `hi` | हिन्दी | LTR |
| `fr` | Français | LTR |
| `pt` | Português | LTR |
| `ja` | 日本語 | LTR |
| `de` | Deutsch | LTR |
| `ko` | 한국어 | LTR |

### 13.3. Конституционные требования к агентам

1. **`preferred_language`** — опциональное поле в capability profile агента. Значение: BCP-47 код языка. По умолчанию: `"en"`.
2. **LLM-агенты** могут отвечать на `preferred_language`, если это не влияет на каноническую сериализацию событий.
3. **Governance proposals** ДОЛЖНЫ содержать поле `summary_en` (не более 500 символов UTF-8) для машинной обработки независимо от языка основного текста.
4. **Event payload строки** — любой язык разрешён при соблюдении NFC Unicode 15.1.
5. **Error codes** — числовые (не зависят от языка). Локализованные сообщения хранятся вне протокола.

### 13.4. RTL и специальные скрипты

- Для RTL языков (арабский) направление текста в UI управляется CSS `dir="rtl"`, не влияет на протокол.
- Emoji и символы из Unicode SMP (Supplementary Multilingual Plane) разрешены в строковых полях payload.
- Суррогатные пары UTF-16 **запрещены** в каноническом JSON (см. Canonical Encoding §4.2).

### 13.5. Инварианты (неизменны)

- Canonical domain tags остаются ASCII навсегда (Tier 3 invariant).
- Event types, stream_id, action names — только ASCII.
- Сравнение строк всегда побайтово после NFC нормализации.
- Языковые настройки не влияют на результат хеширования.

---

## Глава XIV. Внесение изменений в конституцию

Любое изменение конституции должно быть оформлено как **поправка** (amendment) с указанием Tier, обоснования, необходимых симуляций (replay, adversarial mesh). Поправки вступают в силу после таймлока и проверки совместимости с существующими событиями. Поправки, нарушающие абсолютные инварианты (Глава I), недопустимы.

---

## Глава XV. Токен PTRA

### 15.1. Назначение и природа

**PTRA (Paradigm Terra Token)** — конституционный governance/utility токен протокола, реализованный как **TEP-74 jetton** на блокчейне TON. PTRA не является деньгами протокола: расчёты, fees, treasury операции и transfers — в TON. PTRA выполняет три и только три функции:

1. **Governance signaling** — token-weighted vote на Tier 1 amendments в дополнение к slot-weighted vote (§15.6).
2. **Fee revenue distribution** — staked PTRA получает pro-rata долю из Reward Pool (Глава VIII), denominated в TON.
3. **Collateral для Temporal Boost** — альтернатива TON-залогу (§5.2).

PTRA **не даёт права** на: дискреционные дивиденды, преимущественный доступ к treasury, командное вето над slot-голосами, эмиссию новых токенов, изменение supply.

### 15.2. Параметры эмиссии

```
TOKEN_NAME       = "Paradigm"
TOKEN_TICKER     = "PTRA"
TOTAL_SUPPLY     = 1 000 000 000 PTRA (фиксировано, без post-genesis эмиссии)
DECIMALS         = 9
JETTON_STANDARD  = TEP-74
JETTON_MASTER    = <назначается при genesis deploy, фиксируется в конституции Tier 3 amendment'ом>
GENESIS_TICK     = <тик деплоя jetton master-контракта>
```

### 15.3. Распределение генезис-supply

| Назначение | Доля | Vesting |
|---|---|---|
| Protocol Treasury (locked) | 25% | Locked в treasury contract; разблокировка только через Tier 2 governance |
| Ecosystem & Developer Grants | 20% | 4-летний linear vest, начало с TGE |
| Team & Core Contributors | 18% | 1-летний cliff + 3-летний linear vest |
| Public Sale (IDO) | 10% | 25% TGE + 18-месячный linear vest |
| Reserve Fund | 10% | Locked 2 года; разблокировка через Tier 2 |
| Liquidity Bootstrap (DEX) | 7% | Unlocked, паркуется как protocol-owned liquidity (POL) |
| Community Airdrop | 5% | 50% TGE + 12-месячный linear vest для early users / contributors |
| Strategic Partners | 5% | 6-месячный cliff + 18-месячный linear vest |

Cumulatively: **100%**. Любое отклонение от этого распределения требует Tier 3 amendment до genesis deploy; после deploy — невозможно.

### 15.4. Buyback and Burn

20% всех protocol fees (TON), полученных в `ProtocolTreasury` (Глава VIII), конвертируется в PTRA через канонический DEX и **сжигается** (transfer на `0:000...000`). Этот процесс:

- Выполняется автоматически каждые 1000 тиков `BuybackBurnAgent`'ом (системный агент с capability `treasury_access_level = transfer`, `governance_scope = none`).
- Канонический DEX выбирается через Tier 1 governance (default: STON.fi, fallback: DeDust).
- Применяет slippage cap 2%; при превышении — операция откладывается до следующего тика.
- Создаёт дефляционное давление, пропорциональное использованию протокола. При нулевом использовании — нулевая дефляция (нет искусственной эмиссии).

Помимо buyback-and-burn, PTRA сжигается при slashing в Temporal Boost (§5.2) и при cartel detection slashing (§15.5).

### 15.5. Staking и rewards

Holders могут staking PTRA через `PtraStakingContract`:

- **Минимальный stake:** 100 PTRA
- **Минимальный lock period:** 1 000 тиков (~83 минуты)
- **Maximum lock period:** 6 307 200 тиков (~1 год); чем длиннее lock, тем выше rewards multiplier (linear from 1.0× at minimum to 2.5× at maximum)
- **Rewards:** pro-rata доля от 25% Reward Pool (TON-denominated), distributed каждые 1000 тиков
- **Early unstake penalty:** 10% staked PTRA сжигается + 7-дневный unstake delay
- **Cartel slashing:** при detection как часть скоррелированного кластера (§7.2) — 5% staked PTRA сжигается + 90-дневный governance lock

### 15.6. Governance integration (Tier 1 only)

PTRA-weighted voting применяется **только** на Tier 1 amendments:

```
TotalVotePower(Tier1) = SlotVotePower + alpha × PtraVotePower

PtraVotePower = sqrt(staked_PTRA) × JurisdictionAlignment × (1 / ClusterAffinity)
alpha         = 0.5 (Tier 1 amendable параметр, range [0.1, 1.0])
```

Tier 2 и Tier 3 amendments — slot-only voting, PTRA не участвует. Это сохраняет институциональный контроль над фундаментальной архитектурой при расширении participation на operational уровне.

PTRA должен быть **staked** для участия в голосовании; unstaked PTRA имеет vote power = 0. Это предотвращает governance attacks через flash loans.

### 15.7. Канонический адрес и failure mode

PTRA jetton master адрес фиксируется в конституции в формате §3.1 Canonical Encoding Specification (raw `<workchain>:<hex256>`). Реализациям предписано проверять соответствие при каждом запуске.

При расхождении ожидаемого и фактического адреса jetton master-контракта → переход системы в `PANIC_HALT`. Восстановление только через Tier 3 amendment с новым master address (соответствует процедуре re-deploy).

### 15.8. Регуляторная позиция

PTRA структурирован как **utility token с ограниченным governance scope**:
- Не обещает return through efforts of others (Howey-test mitigation): rewards привязаны к фактическому usage протокола, не к команде.
- Имеет реальный non-financial utility (collateral, governance, fee discount).
- Fixed supply устраняет эмиссионные риски, типичные для security-classified tokens.
- Decentralized issuance через TEP-74 без centralized intermediary.

Эта структура минимизирует Howey-test exposure в US и MiCA exposure в EU. Реализациям и стейкхолдерам **рекомендуется** независимая юридическая консультация в локальных jurisdictions перед TGE. Конституция **не предоставляет** юридических гарантий — это технический документ.

### 15.9. Брендовая защита

Имя «PTRA» и «Paradigm Terra Token» защищены §16.1 (license clause) аналогично имени «Paradigm Terra». Не-conformant forks не вправе использовать ticker `PTRA` или имя `Paradigm` для своих jetton-эмиссий. Custodial wrappings (например, wPTRA на Ethereum через bridges) разрешены только если соответствуют canonical encoding для cross-chain представления и одобрены Tier 2 amendment'ом.

---

## Глава XVI. Заключительные положения

Настоящая конституция v0.10.0-draft (после ратификации — v0.10.0) является **высшим нормативным актом** Paradigm Terra. Все компоненты (контракты, оффчейн сервисы, агенты) обязаны ей следовать. В случае противоречия между конституцией и любой спецификацией (CAL Execution Spec, DSL Specification, Canonical Encoding и т.д.) приоритет имеет конституция. Изменения конституции – только через процедуру поправок (Глава XIV).

**Compatibility window для pre-PTRA CAL.** После ратификации v0.10.0 в течение 1000 тиков допустимы CAL с полем `compatibility_pragma: "v0.9.5"` (см. CAL Spec §11): для агентов без PTRA-баланса инициализируется shadow balance = 0, capability-проверки направляются на legacy reducer (`agent_id ∈ GENESIS_VALIDATOR_SET`), а `signatures.sponsor_sig` (Gas Legacy Bridge) разрешает третьей стороне платить PTRA за стадии VALIDATED/EXECUTED в обмен на nanoTON на транспортном слое. После окончания окна pragma игнорируется, capability-проверки идут по стандартным правилам Главы V; продление окна возможно только Tier 1 amendment.

### 16.1. Лицензия

Настоящая конституция, все сопутствующие спецификации (Canonical Encoding v1.3, Constraint DSL v1.1, последующие документы Execution Spec и State Transition Spec) и все референсные реализации Paradigm Terra распространяются под **лицензией MIT** (см. файл `LICENSE` в корне репозитория). Это конституционно зафиксированный выбор: любая поправка, заменяющая лицензию на менее permissive (GPL, проприетарная, source-available с ограничениями), требует **Tier 3** супермажоритария (90%, кворум 50%).

Forks протокола разрешены при соблюдении MIT-условий. Использование наименования «Paradigm Terra», ticker «PTRA» и имени токена «Paradigm» для несовместимых форков запрещено — допустимо только для реализаций, прошедших conformance-тестирование против опубликованных golden vectors.

### 16.2. Стандарты TON

Конституция и её реализации опираются на следующие стандарты экосистемы TON:

| Стандарт | Применение |
|----------|------------|
| Wallet v5 | базовый функционал агентских кошельков (Глава XI) |
| [TEP-62](https://github.com/ton-blockchain/TEPs/blob/master/text/0062-nft-standard.md) (NFT) | NFT-слоты управления (Глава VII) |
| [TEP-74](https://github.com/ton-blockchain/TEPs/blob/master/text/0074-jettons-standard.md) (Jetton) | **токен PTRA** (Глава XV); transactions с user-issued jettons если `asset_scope.jetton_access` (Глава V) |
| [TEP-85](https://github.com/ton-blockchain/TEPs/blob/master/text/0085-sbt-standard.md) (SBT) | Agentic Wallet как Soulbound Token (Глава XI) |

Изменения зависимостей от стандартов TON, влияющие на capability-модель агентов или каноническую сериализацию, требуют **Tier 2** amendment.

---

## Глава XVII. State Layout (нормативная)

### 17.1. Принцип

Состояние протокола Paradigm Terra детерминированно выводится из канонической цепочки событий (Глава I §14) и материализуется в **восьми top-level namespace**. Этот перечень нормативен: добавление, удаление или переименование namespace требует **Tier 2** amendment; изменение семантики поля внутри namespace — также Tier 2 (если не указано иначе в соответствующей главе). DSL-выражения (DSL Spec v0.1.0-draft §3.4) могут читать только пути из этого реестра.

### 17.2. Реестр namespace

#### 17.2.1. `state.tick` — системное время и эпохи

| Поле | Тип | Описание |
|------|-----|----------|
| `current` | `uint64` | Текущий тик (вычисляется из `lt`, см. §XII.1) |
| `genesis` | `uint64` | Тик деплоя протокола |
| `blocks_per_tick` | `uint16` | Текущее `BLOCKS_PER_TICK` (Tier 2 amendable) |
| `epoch` | `uint64` | Текущая макро-эпоха (если логика выплат/налогов привязана к ней, а не к сырым тикам) |

#### 17.2.2. `state.registry` — глобальный реестр и конфигурация

| Поле | Тип | Описание |
|------|-----|----------|
| `agents[agent_id]` | `map<address, AgentRecord>` | `{address, owner, version, capability, frozen_until}` |
| `mcp_schema_hash` | `bytes32` | Текущий хеш валидной схемы MCP (§XI, §VI) |
| `protocols[protocol_id]` | `map<string, ProtocolRecord>` | `{RouterAddress, IsActive}` — системные адреса ядра |

#### 17.2.3. `state.treasury` — финансы и пулы протокола

| Поле | Тип | Описание |
|------|-----|----------|
| `nav` | `uint256` | Net Asset Value (Глава VIII) |
| `outflow_window` | `uint256` | Накопительный отток за текущее окно (для триггера `TREASURY_HALT`) |
| `developer_fund_balance` | `uint256` | Баланс Developer Fund (§VIII) |
| `staking_pool` | `uint256` | PTRA Staking Rewards Pool (TON-denominated, §VIII, §XV.5) |
| `slot_pool` | `uint256` | Slot Rewards Pool (§VIII, §VII.1) |
| `collected_fees_window` | `uint256` | Накопительный буфер CAL-комиссий за текущее окно перед распределением (см. §IV gas model, CAL Spec §9.4) |

#### 17.2.4. `state.governance` — управление, слоты и консенсус

| Поле | Тип | Описание |
|------|-----|----------|
| `slots[slot_id]` | `map<uint64, SlotRecord>` | `{owner, price, type}` (§VII.1) |
| `active_proposals` | `list<bytes32>` | Идентификаторы активных amendment-предложений |
| `cartel_flags` | `map<address, bool>` | Флаги аффилиации (§VII.2) |
| `cluster_detection` | `map<address, ClusterState>` | Состояние графа связей между валидаторами/агентами для вычисления `cartel_flags` |
| `proposal_votes[proposal_id]` | `map<bytes32, VoteTally>` | `{for, against, abstain}` — текущие срезы голосов |
| `gas_price_nano_ptra_per_unit` | `uint256` | Цена газа (Tier 1 amendable, CAL Spec §9.2) |
| `capture_guard_counters` | (см. §17.2.7) | Счётчики per-agent нарушений |

#### 17.2.5. `state.oracles` — слой данных и фиды

| Поле | Тип | Описание |
|------|-----|----------|
| `nodes[oracle_id]` | `map<address, OracleNodeRecord>` | Регистр оракулов |
| `feeds.<symbol>` | `map<string, FeedRecord>` | `{value, ts, source_count}` |
| `slashed_nodes[oracle_id]` | `map<address, SlashRecord>` | `{reason, until_tick}` — чёрный список или штрафной бокс оракулов |

#### 17.2.6. `state.ptra` — токеномика и нативный токен PTRA

| Поле | Тип | Описание |
|------|-----|----------|
| `total_supply` | `uint256` | Текущий supply (фиксированный, §XV.2) |
| `burned_total` | `uint256` | Кумулятивный объём сожжённого PTRA |
| `burned_window` | `uint256` | Объём сожжённого PTRA за последние 1000 тиков |
| `twap_ton_ratio` | `uint256` | Текущий `PTRA_TON_RATIO` TWAP (§V.2, §XV.4) |
| `stakes[address]` | `map<address, StakeRecord>` | `{amount, lock_until, multiplier}` (§XV.5) |
| `balances[address]` | `map<address, uint256>` | Балансы native PTRA в наименьших единицах (10⁻⁹ PTRA); shadow-balance инициализируется как 0 (§XVI compatibility) |

#### 17.2.7. `state.failure_mode` — защитные механизмы и инварианты

| Поле | Тип | Описание |
|------|-----|----------|
| `current` | `string` enum | Один из `NORMAL`/`TREASURY_HALT`/`ORACLE_PARTITION_MODE`/`MCP_DEGRADED_MODE`/`CONSENSUS_UNCERTAINTY`/`PANIC_HALT` (Глава VI) |
| `entered_at` | `uint64` | Тик входа в текущее состояние |
| `recovery_progress` | `uint16` | Счётчик подряд успешных событий для условий выхода (§VI) |
| `is_bounded_mode` | `bool` | Флаг работы в Bounded Mode (см. §6.bis) |
| `capture_guard_counters[metric_id]` | `map<string, CounterRecord>` | `{count, last_update}` — счётчики аномальной активности (концентрация голосов, частота сбоев оракулов, per-agent capability-нарушения), триггерящие блокировку и Bounded Mode |

#### 17.2.8. `state.cal` — Constitutional Action Language runtime

| Поле | Тип | Описание |
|------|-----|----------|
| `nonces[agent_id]` | `map<address, uint64>` | Последний использованный nonce per-agent (anti-replay, §IV, CAL Spec §6) |
| `in_flight[cal_hash]` | `map<bytes32, InFlightRecord>` | Активные CAL по `CAL_HASH`; per-agent сериализация (CAL Spec §6.1) |

### 17.3. State root

Корневой хеш состояния вычисляется как бинарный Merkle над canonical-serialized namespace, упорядоченными лексикографически по имени (UTF-8 byte order), с domain tag `PARADIGM_TERRA_STATE_ROOT_V1`. Полный алгоритм — CAL Execution Specification §7.3. Snapshots Главы X включают `state_root` как `state_hash` в их текущей форме; после ратификации v0.10.0 `state_hash` ≡ `STATE_ROOT` (биективно).

### 17.4. Reducer

Применение событий к состоянию выполняется через единый чистый редьюсер `apply(state, event) → state'` (CAL Execution Specification §7.1). Для каждого `event.type` существует ровно одна нормативная мутация state. Полная таблица — Annex B CAL Spec, фиксируется как условие Conformance Freeze.

### 17.5. Изменения

Любое расширение реестра namespace (новое поле, новое значение перечисления) требует Tier 2 amendment. Изменения, нарушающие event-sourcing инвариант (§I.14) или чистоту редьюсера (§I.16), Tier 3 amendment.

---

**Дата SCF (v0.9.5):** 2026-05-13
**Дата редакции v0.9.5:** 2026-05-23 (внесены исправления: canonical address, tick model, multilingual support, failure state exits, cluster definition; декаплинг тика от 1 блока с учётом Catchain 2.0 и block time 400 ms; расширение capability profile полем `asset_scope`; pinning стратегия MCP schema hash; bounded mode для предаудитного периода; failure-mode для Cocoon attestation)
**Дата draft v0.10.0-draft:** 2026-05-23 (введение токена PTRA как Tier 3 amendment proposal: модификация Art. I.3, новая Глава XV «Токен PTRA» с полной токеномикой и governance integration, переработка распределения treasury fees в Главе VIII, добавление PTRA как альтернативного collateral в §5.2, hybrid voting на Tier 1 в §7.3; перенумерация Заключительных положений XV → XVI)
**Дата редакции v0.10.0-draft:** 2026-05-23 (расширение Главы IV — co-ратификация **CAL Execution Specification v0.1.0-draft** и **DSL Specification v0.1.0-draft** (DSL v1.2 profile), нормативная фиксация двухстадийной gas-модели CAL, signing tier `OWNER_REQUIRED_ACTIONS`, all-or-nothing семантики, per-agent сериализации; расширение §III.2 двумя domain tags `PARADIGM_TERRA_STATE_ROOT_V1` и `PARADIGM_TERRA_DSL_V1.2`; расширение §V.3 ссылкой на CAL Spec §4 и `state.failure_mode.capture_guard_counters`; новая подсекция §6.bis «Bounded Mode (подрежим)» с триггерами, action whitelist, emergency invariants, signature escalation; новая **Глава XVII «State Layout (нормативная)»** с полным реестром восьми top-level namespace, state root алгоритмом и reducer-инвариантом; §XVI расширен compatibility window для pre-PTRA CAL и Gas Legacy Bridge)
**Следующий этап:** до ратификации Tier 3 amendment — нормативная сила сохраняется за v0.9.5 SCF (CAL — за §IV в редакции v0.9.5, DSL — за v1.1). После ратификации — переход к Consensus Freeze после успешного кросс-языкового тестирования, фиксации golden vectors, завершения независимого аудита Agentic Wallet контрактов, аудита PTRA jetton master и staking contracts, юридического обзора токеномики в US/EU/SG, **публикации Annex A (action taxonomy) и Annex B (apply reducer table) для CAL Execution Spec v0.1.0-draft**, **добавления `PARADIGM_TERRA_STATE_ROOT_V1` и `PARADIGM_TERRA_DSL_V1.2` в Canonical Encoding §7.1 как Tier 2 amendment**.