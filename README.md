<div align="center">

# PennyWise — Your Khata Agent
### AI-Powered 3-Way Financial Reconciliation for Modern Finance Teams

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![Python Version](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)](https://www.python.org/)
[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js&logoColor=white)](https://nextjs.org/)
[![FastMCP](https://img.shields.io/badge/FastMCP-20+_Tools-0D94FB)](https://github.com/jlowin/fastmcp)

<p align="center">
  <a href="#key-features">Key Features</a> •
  <a href="#pennywise-ai-copilot-capabilities">AI Copilot</a> •
  <a href="#repository-structure">Repo Structure</a> •
  <a href="#architecture-at-a-glance">Architecture</a> •
  <a href="#technology-stack">Tech Stack</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#usage-examples">Usage Examples</a> •
  <a href="#screenshots">Screenshots</a> •
  <a href="#documentation">Docs</a>
</p>

</div>

---

<a id="introduction"></a>
## Introduction

Financial reconciliation is traditionally a manual, stressful, and error-prone grind. High-velocity businesses struggle with disparate statement formats, multi-currency conversions, gateway fee deductions, batch settlements, and timing delays between billing invoices, payment gateway records, and bank deposits. Unreconciled accounts lead to delayed financial closes, cash leakage, and audit headaches.

**PennyWise** transforms reconciliation from a tedious chore into an autonomous, intelligent experience. By pairing a high-throughput data standardization pipeline with bipartite Hungarian optimization and subset-sum matching algorithms, PennyWise solves 1:1, N:1, and 1:N transaction realization with mathematical precision.

Equipped with **PennyWise AI**—an interactive financial audit assistant powered by the Model Context Protocol (FastMCP)—finance teams can query audit exceptions in natural language, draft audit-ready dispute memos, and dispatch counterparty resolution emails with zero friction.

---

<a id="key-features"></a>
## Key Features

| Feature | Description |
| :--- | :--- |
| **3-Way Reconciliation** | Global bipartite Hungarian optimization + Subset-sum solvers for 1:1, N:1 batched payouts, and 1:N split settlements. |
| **PennyWise AI Assistant** | Conversational financial copilot to query exceptions, investigate discrepancies, and analyze settlements. |
| **Agentic Mode Switch** | UI toggle between **Ask Mode** (read-only advisory) and **Agentic Mode** (autonomous write & dispatch execution). |
| **Email Resolution** | One-click generation and dispatch of vendor resolution and dispute emails via Google OAuth & Gmail API. |
| **Interactive Dashboard** | Next.js 15 & Tailwind dashboard with waterfall realization charts, coverage donuts, and realization gauges. |
| **Exception Management** | Automated categorization of **Missing Cash** (High Risk) vs. **Unallocated Cash** (Extra Cash) with resolution workflows. |
| **Data Standardisation** | High-throughput parallel LLM normalization for semantic vendor naming, unified date parsing, and live FX conversion. |
| **Immutable Audit Trail** | Timestamped snapshot backups and full historic audit logs for reversible ledger modifications. |

---

<a id="pennywise-ai-copilot-capabilities"></a>
## PennyWise AI Copilot: Capabilities

PennyWise functions as an interactive financial accountant agent integrated directly into the reconciliation workflow via the Model Context Protocol (FastMCP):

- **Root-Cause Diagnostics**: Investigates why specific invoices or settlements failed matching, diagnosing fee deductions, timing delays, or missing bank deposits.
- **Universal Multi-Ledger Search**: Scans across Invoices, Razorpay settlements, and Bank statements simultaneously by UTR, customer, or amount.
- **Ledger Mutation & Reassignment**: Corrects misclassified vendors, adjusts fee allocations, and updates customer accounts with pre-mutation snapshot backups.
- **Dispute Memo Generation**: Synthesizes formal, audit-ready dispute memos with variance breakdowns and remediation steps.
- **Closed-Loop Gmail Resolution**: Dispatches resolution emails directly to counterparties via Google OAuth and auto-marks exceptions as resolved.
- **Dual Execution Safety**: Operates in read-only **Ask Mode** for exploratory auditing, and unlocks full ledger mutation tools in **Agentic Mode**.

---

<a id="repository-structure"></a>
## Repository Structure

```text
Razorpay-2/
├── api/                    # FastAPI backend (REST endpoints, SSE chat streaming, OAuth routing)
├── chat-bot/               # PennyWise AI agent (FastMCP tool caller, skill routing, sliding memory)
├── frontend/               # Next.js 15 dashboard (App Router, Tailwind CSS, Recharts, Zustand)
├── mcp_server/             # FastMCP server (22+ financial tools for queries, edits, and emails)
├── reconciliation/         # 3-Way matching engine (Hungarian bipartite & Subset-sum solvers)
├── standardisation/        # Two-phase data standardization pipeline & batch LLM client
├── synthetic data/         # Deterministic test ledger generators (Invoices, Razorpay, Bank)
├── docs/                   # Documentation assets & UI screenshots
├── .env                    # Single source of truth environment configuration
├── .env.example            # Official template for onboarding & git clone
├── ARCHITECTURE.md         # In-depth system design, algorithms & technical reference
├── QUICKSTART.md           # Step-by-step local installation and setup guide
├── README.md               # Main project overview and user documentation
└── requirements.txt        # Unified global backend Python dependencies
```

### Directory Breakdown and Responsibilities

| Directory | Core Files | Responsibility & Use Case |
| :--- | :--- | :--- |
| **`api/`** | `main.py`, `auth.py`, `email_api.py` | FastAPI application layer providing REST endpoints for file staging (`/api/upload`), standardization (`/api/standardize`), reconciliation (`/api/reconcile`), SSE streaming (`/api/chat/stream`), and Google OAuth 2.0 session handling. |
| **`chat-bot/`** | `chat_bot.py`, `skills_catalog.md`, `system_prompt.txt`, `workspace/skills/` | Conversational financial copilot. Implements the agentic loop, progressive skill routing, 5-turn sliding window memory, and in-process tool execution against the FastMCP tool bus. |
| **`frontend/`** | `src/app/`, `src/components/`, `src/store/`, `src/lib/` | Next.js 15 web application delivering the executive reconciliation dashboard, interactive 3-way review/edit tables, real-time analytics charts (donut, gauge, waterfall), and the PennyWise AI drawer with the Agentic Mode toggle. |
| **`mcp_server/`** | `server.py`, `test_mcp.py`, `test_parsing.py` | Model Context Protocol (FastMCP) server hosting 22+ financial tools categorized into Read-Only audit tools (11 tools), Write/Mutation tools (10 tools guarded by Agentic Mode), and Gmail dispatch tools. |
| **`reconciliation/`** | `hungarian_matcher.py`, `subset_sum_matcher.py`, `config.py`, `run_reconciliation.py` | Core mathematical matching engine. Implements global bipartite Hungarian optimization for 1:1 pairs, combinatorial branch-and-bound subset-sum solving for N:1 and 1:N batch settlements, and residual ledger classification. |
| **`standardisation/`**| `standardizer.py`, `llm_client.py`, `prompts.py` | High-throughput two-phase data normalization pipeline. Phase 1 executes semantic vendor clustering via concurrent LLM worker pools and in-memory caching; Phase 2 performs deterministic ISO-8601 date parsing and multi-currency FX conversions. |
| **`synthetic data/`** | `generate_invoices.py`, `generate_razorpay.py`, `generate_bank.py` | Deterministic synthetic dataset generator used for development, benchmarking, and ground-truth validation, maintaining exact relational mappings across invoices, orders, gateway settlements, and bank credits. |
| **`docs/`** | `docs/screenshots/` | Documentation assets and interface screen captures illustrating end-to-end reconciliation and resolution workflows. |

---

<a id="architecture-at-a-glance"></a>
## Architecture at a Glance

```mermaid
flowchart LR
    A[User Uploads CSVs] --> B[Standardisation Pipeline]
    B --> C[Vendor Normalisation]
    B --> D[Date & Currency Conversion]
    C --> E[Standardised Data]
    D --> E
    E --> F[Reconciliation Engine]
    F --> G[Hungarian 1:1 Matching]
    F --> H[Subset-Sum N:1/1:N Matching]
    G --> I[Results & Exceptions]
    H --> I
    I --> J[Dashboard]
    I --> K[PennyWise AI]
    K --> L[Query Exceptions]
    K --> M[Draft Memos]
    K --> N[Send Emails]
    N --> O[Gmail API]
```

> For an in-depth breakdown of algorithms, mathematical formulations, and MCP tool schemas, see [ARCHITECTURE.md](ARCHITECTURE.md).

---

<a id="technology-stack"></a>
## Technology Stack

| Layer | Technologies |
| :--- | :--- |
| **Backend API** | FastAPI, Python 3.10+, Uvicorn (ASGI) |
| **Frontend Web App** | Next.js 15 (App Router), TypeScript, Tailwind CSS |
| **UI Components & Charts** | Radix UI, shadcn/ui, Lucide Icons, Recharts |
| **State Management** | Zustand |
| **Reconciliation Engine** | NumPy, Pandas, SciPy (`linear_sum_assignment`), Combinatorial Solvers |
| **Agent & Tools** | FastMCP (Model Context Protocol), OpenAI-Compatible LLM API |
| **Auth & Communications** | Google OAuth 2.0, Gmail REST API, ItsDangerous |

---

<a id="quick-start"></a>
## Quick Start

### 1. Clone & Configure Environment

```bash
# Clone the repository
git clone https://github.com/harissh-k06/Razorpay_Buildathon.git
cd Razorpay-2

# Copy the environment configuration template
cp .env.example .env
```

Open `.env` and provide your OpenAI-compatible LLM API Key:
```env
MODEL_API_KEY="your_api_key_here"
```

### 2. Backend Setup

```bash
# Create and activate virtual environment
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install all backend dependencies
pip install -r requirements.txt

# Start FastAPI backend
uvicorn api.main:app --port 8000 --reload
```

### 3. Frontend Setup

In a new terminal:
```bash
cd frontend
npm install
npm run dev
```

Visit [http://localhost:3000](http://localhost:3000) in your browser.

> For complete setup and troubleshooting details, see [QUICKSTART.md](QUICKSTART.md).

---

<a id="usage-examples"></a>
## Usage Examples

### 1. Investigating Unmatched Transactions
```text
User: "Why is invoice INV-034 not matched?"

PennyWise: "INV-034 for ₹39,541.82 (Adobe) is currently unmatched because no matching 
settlement was received from the payment gateway. 

Audit Details:
- Issue Date: 2026-03-02 | Due Date: 2026-04-01
- Gross Amount: ₹39,541.82
- Category: High Risk (Missing Cash / Unsettled Receivables)

Potential Root Causes:
1. Payout settlement is pending from the gateway
2. Transaction was processed offline via direct NEFT/RTGS
3. Payment failed at gateway checkout"
```

### 2. Drafting Dispute & Clarification Memos
```text
User: "Draft a dispute memo for INV-034"

PennyWise: [Generates a formal, audit-ready dispute memo containing transaction references, 
counterparty information, outstanding variance, and required remediation steps.]
```

### 3. Dispatching Counterparty Resolution Emails
```text
User: "Send this memo to billing@adobe.com"

PennyWise: "Resolution email drafted and dispatched via Gmail API to billing@adobe.com. 
Exception record INV-034 has been marked as Resolved in the audit log."
```

---

<a id="screenshots"></a>
## Screenshots

### 1. Ingestion & Raw Statement Files

| Statement Upload Interface | Raw Invoices Statement (CSV) |
|:---:|:---:|
| ![Statement Upload](docs/screenshots/upload.png) | ![Raw Invoices](docs/screenshots/raw_invoices.png) |

| Raw Razorpay Settlements (CSV) | Raw Bank Statement (CSV) |
|:---:|:---:|
| ![Raw Razorpay Settlements](docs/screenshots/raw_razorpay.png) | ![Raw Bank Statement](docs/screenshots/raw_bank.png) |

### 2. Standardization & 3-Way Review

| Data Standardisation Pipeline | 3-Way Dataset Review & Editing |
|:---:|:---:|
| ![Data Standardisation](docs/screenshots/standardisation.png) | ![3-Way Dataset Review](docs/screenshots/review.png) |

### 3. Executive Analytics & Visualizations

| Executive KPI Cards | Reconciliation Results Dashboard |
|:---:|:---:|
| ![Executive KPI Cards](docs/screenshots/kpi_cards.png) | ![Reconciliation Results](docs/screenshots/results.png) |

| Status Distribution Donut Chart | Invoice Match Realization Gauge | Financial Flow Waterfall Realization |
|:---:|:---:|:---:|
| ![Status Distribution](docs/screenshots/charts_distribution.png) | ![Invoice Match Gauge](docs/screenshots/charts_gauge.png) | ![Financial Flow Waterfall](docs/screenshots/charts_waterfall.png) |

### 4. PennyWise AI Copilot & Resolution Workflows

| AI Data Audit (Review Page) | AI Dispute Memos (Results Page) |
|:---:|:---:|
| ![AI Data Audit](docs/screenshots/pennywise_chat_review.png) | ![AI Dispute Memos](docs/screenshots/pennywise_chat_results.png) |

| One-Click Gmail Resolution Dispatch | Exception Investigation (Missing Cash) |
|:---:|:---:|
| ![Gmail Resolution Dispatch](docs/screenshots/pennywise_chat_email.png) | ![Exception Management](docs/screenshots/exceptions.png) |

| Unallocated Cash Management |
|:---:|
| ![Unallocated Cash](docs/screenshots/unallocated.png) |

---

<a id="documentation"></a>
## Documentation

- [Quick Start Guide](QUICKSTART.md) — Step-by-step installation and local setup.
- [Architecture Deep Dive](ARCHITECTURE.md) — Core matching algorithms, data pipelines, and MCP design.
- [License](LICENSE) — Apache 2.0 License.

---

<a id="license"></a>
## License

This project is licensed under the Apache License 2.0. See the [LICENSE](LICENSE) file for details.
