# Paradigm Terra — External References

Все внешние ссылки, используемые в спецификациях протокола.

---

## TON AI Ecosystem

| Ресурс | URL | Применение в протоколе |
|--------|-----|------------------------|
| TON AI Overview | https://docs.ton.org/overview/ai/overview | Общий обзор TON AI, @ton/mcp как точка входа |
| TON Agentic Wallets | https://docs.ton.org/overview/ai/wallets | Стандарт Agentic Wallet: SBT, split-key архитектура, @ton/mcp SDK |
| TON MCP (глава AI) | https://docs.ton.org/overview/ai/mcp | MCP-сервер для TON: инструменты, wallets, docs |
| Agentic Wallets Dashboard | https://agents.ton.org/ | Веб-интерфейс: создание, мониторинг, ротация ключей, отзыв |
| TON MCP Portal | https://mcp.ton.org/ | Хостинговый MCP-сервер для агентов (docs + blockchain) |
| TON Docs MCP endpoint | https://docs.ton.org/mcp | Machine-readable endpoint документации TON |
| TON Docs LLMs.txt | https://docs.ton.org/llms.txt | Индекс документации для AI-агентов |

## TON Smart Contract Toolchain

| Ресурс | URL | Применение в протоколе |
|--------|-----|------------------------|
| Acton Docs | https://ton-blockchain.github.io/acton/docs/welcome | CLI-тулчейн для смарт-контрактов TON (Rust, Tolk) |
| Acton: Installation | https://ton-blockchain.github.io/acton/docs/installation | Установка Acton |
| Acton: Quickstart | https://ton-blockchain.github.io/acton/docs/quickstart | Быстрый старт |
| Acton: Testing | https://ton-blockchain.github.io/acton/docs/testing/overview | Тестирование контрактов, golden tests |
| Acton: Deploy | https://ton-blockchain.github.io/acton/docs/deploy | Деплой контрактов |
| Acton: Verification | https://ton-blockchain.github.io/acton/docs/verify | Верификация байткода |
| Acton: Commands | https://ton-blockchain.github.io/acton/docs/commands/overview | Справочник команд |
| Acton Contracts (GitHub) | https://github.com/ton-blockchain/acton-contracts | Референсные контракты: NFT v1.1, Jetton v2.1, Wallet W5.2, Multisig v2.1, Highload v3.1 |
| TON Skills (AI coding) | https://github.com/ton-blockchain/skills | Skills для AI coding agents (wallets + docs bundles) |

## Cocoon: Confidential Compute

| Ресурс | URL | Применение в протоколе |
|--------|-----|------------------------|
| Cocoon Developers | https://cocoon.org/developers | Confidential compute (Intel TDX), оплата через TON |
| Cocoon GPU Owners | https://cocoon.org/gpu-owners | Провайдеры GPU: участие, экономика, H100+, TDX |
| Cocoon GitHub | https://github.com/TelegramMessenger/cocoon | Исходный код Cocoon |
| Cocoon Telegram | https://t.me/cocoon | Сообщество |

## TON Community & Standards

| Ресурс | URL | Применение в протоколе |
|--------|-----|------------------------|
| AI Dev Wall (Telegram) | https://t.me/ai_dev_wall | Канал для TON AI builders |
| TON Whitepaper | https://ton.org/whitepaper.pdf | §3.1: TON Cell hash (используется в Canonical Encoding §5) |
| TON Connect — Core concepts | https://docs.ton.org/applications/ton-connect/core-concepts | Execution Spec §8.3: нормативный канал owner-sig ingress (`signMessage`, `ton_proof`) |
| Wallet V5 spec | https://docs.ton.org/blockchain-basics/standard/wallets/v5 | `cal-validator-design.md` §10: W5 ↔ CAL изоморфизм (ContractState — каноническая on-chain проекция CAL auth state) |
| Wallet comparison | https://docs.ton.org/blockchain-basics/standard/wallets/comparison | Контекст для §8.3 совместимости кошельков (V5/Highload/Multisig features) |
| TON fees overview | https://docs.ton.org/blockchain-basics/primitives/fees | Формулы fee-расчёта (storage / gas / forward / action) — основа CAL Spec §C.5 калибровки |
| TON ConfigParam reference | https://docs.ton.org/blockchain-basics/primitives/config | Документация ConfigParam 18/20/21/24/25 — referenced в §C.5.1 snapshot table |
| Tonviewer config (live values) | https://tonviewer.com/config | Источник pinned mainnet значений §C.5.1 (snapshot date stamped) |

---

## Маппинг ссылок → разделы спецификаций

```
Cocoon (confidential compute)
  → Конституция: Глава V §5.1 (confidential_compute_allowed)
  → Конституция: Глава I §12 (конфиденциальное исполнение)

Agentic Wallets / agents.ton.org / @ton/mcp
  → Конституция: Глава XI (Agentic Wallets and MCP)
  → Конституция: Преамбула (Agentic Wallets)
  → Execution Spec: §8.2 (запрет прямых вызовов TON API)

Acton Docs / Acton Contracts
  → Execution Spec: §7.2 (golden tests, cross-platform)
  → Execution Spec: §8.1 (CAL Validator, Event Indexer)
  → Конституция: Глава II §2.2 (деплой агентов)

TON AI Overview / TON MCP Portal
  → Execution Spec: §8.1 (MCP gateway)
  → Конституция: Глава XI (MCP schema hash)
```
