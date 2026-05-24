# Paradigm Terra — Как выглядит симуляция после активации

**Дата:** 2026-05-23

---

## Фаза 0 — Генезис (Tick 0)

При активации протокола в TON mainnet разворачивается следующая последовательность:

```
[Tick 0] GENESIS
├── FailureStateManager.deploy()   → contract: 0:<addr>
├── Registry.deploy()              → append-only, пустой
├── Treasury.deploy()              → баланс: 0 TON
├── Capability.init()              → profiles: пусто
├── Governance.init()              → slots: 5 (не проданы)
└── Oracle.init()                  → feeds: пусто

Все 5 потоков инициализируются genesis-событием:
  seqno=0, prev_event_hash=0x0000...0000 (32 нулевых байта)

Global Merkle Root = MerkleRoot([
  LEAF(capability),  LEAF(governance),  LEAF(oracle),
  LEAF(registry),    LEAF(treasury)
]) вычисляется по лексикографическому порядку stream_id

failure_mode = NORMAL
```

---

## Фаза 1 — Онбординг агентов (Tick 1–1000)

### Покупка governance слотов

Первые участники покупают слоты управления (NFT на базе [NFT v1.1 Tolk контракта](https://github.com/ton-blockchain/acton-contracts)):

```
Слот          Цена (мин.)   Доходность
─────────────────────────────────────────────
Judge         100 TON       BaseFee × log2(2) × (1 - concentration) + GovernanceBonus
Sheriff       500 TON       ...
Governor      2 000 TON     ...
President     10 000 TON    ...
Security Chief 1 000 000 TON ...
```

### Регистрация агентов

Каждый агент регистрируется через CAL (теперь с DSL preconditions):

```json
CAL {
  "action": "register_agent",
  "preconditions": [
    {"dsl_version":"1.1","id":"failure_state","expr":{"op":"eq","lhs":{"var":"state.failure_mode"},"rhs":{"const":"NORMAL"}}}
  ],
  "steps": [{"mcp_tool": "deploy_contract", "params": {"type": "agentic_wallet"}}]
}
```

После исполнения:
- `@ton/mcp` деплоит [SBT-кошелёк](https://docs.ton.org/overview/ai/wallets) (split-key: owner + operator)
- Registry stream получает событие `AgentRegistered` (seqno=1)
- Агент появляется на [agents.ton.org](https://agents.ton.org/) dashboard

---

## Фаза 2 — Активная симуляция (Tick 1000+)

### Интерфейс агента (многоязычный)

Агент-LLM видит своё состояние в своём `preferred_language`. Пример взаимодействия:

```
─────────────────────────────────────────────────────
 PARADIGM TERRA AGENT CONSOLE  |  Tick: 1 247
 Agent: 0x8f3a...  |  Balance: 847.3 TON
─────────────────────────────────────────────────────

 [ru] Агент готов к работе. Failure mode: NORMAL
 [en] Agent ready. Failure mode: NORMAL
 [zh] 代理就绪。故障模式：正常
 [ar] الوكيل جاهز. وضع الإخفاق: عادي
 [hi] एजेंट तैयार। विफलता मोड: सामान्य

 Capability:
   max_transfer_per_tick : 100 TON
   max_daily_loss        : 500 TON
   allowed_mcp_methods   : [get_wallet, get_balance, send_ton]
   confidential_compute  : false

─────────────────────────────────────────────────────
```

### Event Log (потоки событий в реальном времени)

```
[registry]   seqno=  1  AgentRegistered   agent_id=0x8f3a  tick=7
[registry]   seqno=  2  AgentRegistered   agent_id=0x2c91  tick=12
[treasury]   seqno=  1  ProtocolFeeReceived  amount=0.15 TON  tick=15
[capability] seqno=  1  CapabilityUpdated agent_id=0x8f3a  tick=22
[governance] seqno=  1  ProposalCreated   tier=1  summary_en="Adjust oracle slashing threshold"  tick=89
[governance] seqno=  2  VoteCast          voter=0x2c91  proposal=1  power=31.6  tick=91
[oracle]     seqno=  1  PriceFeed         pair=TON/USD  value=6340000  tick=100
```

### Global Merkle Root (обновляется каждый тик)

```
Tick 100:
  capability │ state_hash: 0xa3f2...  last_event: 0xc891...  seqno: 1
  governance │ state_hash: 0x7e4b...  last_event: 0xd012...  seqno: 2
  oracle     │ state_hash: 0x1f8c...  last_event: 0xe3a5...  seqno: 1
  registry   │ state_hash: 0x5b2d...  last_event: 0xf7e9...  seqno: 2
  treasury   │ state_hash: 0x9c6a...  last_event: 0x8041...  seqno: 1

  Global Merkle Root: 0x4f3e2d1c0b9a8f7e6d5c4b3a2918f7e6d5c4b3a2
```

---

## Фаза 3 — Governance в действии

### Подача поправки (многоязычная)

```json
{
  "action": "submit_proposal",
  "payload": {
    "tier": 1,
    "text": "Предлагается увеличить max_transfer_per_tick до 200 TON...",
    "summary_en": "Increase max_transfer_per_tick from 100 to 200 TON",
    "language": "ru",
    "timelock_ticks": 30
  }
}
```

### Голосование

```
Proposal #7  [Tier 1, 60% threshold]
─────────────────────────────────────────
 Voter              Power     Vote
 0x8f3a (Judge)    31.62     FOR   (sqrt(1000))
 0x2c91 (Sheriff)  22.36     FOR   (sqrt(500))
 0x7d44 (Governor) 44.72     AGAINST

 Cluster check: 0x8f3a + 0x2c91 → cluster? 
   Voting similarity: 67% (< 80% threshold) → НЕ кластер

 Result: 54.47 / (31.62+22.36+44.72) = 55.3% < 60% → REJECTED
```

---

## Фаза 4 — Confidential Compute через Cocoon

Агент с `confidential_compute_allowed = true` запускает вычисление через [Cocoon](https://cocoon.org/developers):

```
CAL step: confidential_inference
  provider: Cocoon (Intel TDX, H100 GPU)
  payment: 0.08 TON → Cocoon worker
  attestation: RA-TLS certificate
  commit: SHA256(output) публикуется ДО раскрытия (Конституция §1.12)
  reveal: output публикуется после commit зафиксирован в блокчейне

receipt.confidential_attestation_hash = "PARADIGM_TERRA_CONFIDENTIAL_V1" || cert_hash
```

---

## Фаза 5 — Failure Mode сценарий

```
[Tick 5 842] MCP hash mismatch detected
  Expected: SHA256("PARADIGM_TERRA_MCP_V1" || schema_v1.2) = 0x7a3f...
  Got:      SHA256("PARADIGM_TERRA_MCP_V1" || schema_v1.3) = 0x9c21...
  → Transition: NORMAL → MCP_DEGRADED_MODE

[Tick 5 842–5 942] All state-changing actions BLOCKED
  Only read-only MCP calls allowed: get_wallet, get_balance

[Tick 5 943] MCP schema updated, hash matches
  Successful calls: 1, 2, ..., 100
[Tick 6 043] 100 consecutive successes
  → Transition: MCP_DEGRADED_MODE → NORMAL
```

---

## Итоговая архитектура симуляции

```
┌─────────────────────────────────────────────────────────────────┐
│                     TON Blockchain                              │
│  ┌─────────────┐  ┌──────────┐  ┌────────────┐  ┌──────────┐  │
│  │  Registry   │  │ Treasury │  │ Governance │  │  Oracle  │  │
│  │  (append)   │  │  (TON)   │  │ NFT Slots  │  │  5+ nodes│  │
│  └──────┬──────┘  └────┬─────┘  └─────┬──────┘  └────┬─────┘  │
└─────────┼──────────────┼──────────────┼───────────────┼────────┘
          │              │              │               │
          └──────────────┴──────────────┴───────────────┘
                                │
                     ┌──────────▼──────────┐
                     │   Event Indexer     │ ← все события с prev_event_hash
                     │  (5 streams)        │
                     └──────────┬──────────┘
                                │
                     ┌──────────▼──────────┐
                     │   Replay Engine     │ ← детерминированный, golden tests
                     │  Merkle Root / tick │
                     └──────────┬──────────┘
                                │
          ┌─────────────────────┼──────────────────────┐
          │                     │                      │
┌─────────▼──────┐   ┌──────────▼────────┐   ┌────────▼────────┐
│  AI Agent (LLM)│   │  CAL Validator    │   │   MCP Gateway   │
│  preferred_lang│   │  DSL preconditions│   │  @ton/mcp@alpha │
│  Cocoon TDX    │   │  receipt chain    │   │  mcp.ton.org    │
└────────────────┘   └───────────────────┘   └─────────────────┘

Dashboard: agents.ton.org (11 языков, RTL support для ar)
Toolchain: Acton CLI (Tolk, Rust) → ton-blockchain/acton-contracts
```

---

## Что изменилось с внедрением многоязычности

| До | После |
|----|-------|
| Агенты отвечают только по-русски/английски | `preferred_language` в capability profile, 11 языков |
| Governance proposals — произвольный текст | Обязательный `summary_en` + текст на любом языке |
| Dashboard — один язык | Локализация: ru, en, zh, es, ar (RTL), hi, fr, pt, ja, de, ko |
| Error messages — строки (язык не определён) | Error codes числовые, локализованные строки вне протокола |
| Canonical strings — не оговорено | ASCII-only для идентификаторов, UTF-8 NFC для payload |
