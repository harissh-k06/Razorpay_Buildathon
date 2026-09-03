# PennyWise Quick Start Guide

Welcome to **PennyWise – Your Autonomous Khata Agent**. Follow this guide to get the platform up and running locally on any Windows, macOS, or Linux machine.

---

## Prerequisites

- **Python 3.10+** ([python.org](https://www.python.org/downloads/))
- **Node.js 18+** and **npm** ([nodejs.org](https://nodejs.org/))
- An API Key for any **OpenAI-Compatible LLM** (DeepSeek, OpenAI, Groq, OpenRouter, Together, etc.)

---

## Step 1: Clone & Configure Environment

```bash
# 1. Clone the repository
git clone https://github.com/harissh-k06/pennywise-your-khata-agent.git
cd pennywise-your-khata-agent

# 2. Copy the environment configuration template
# On Windows (PowerShell / CMD):
copy .env.example .env

# On macOS / Linux:
cp .env.example .env
```

Open `.env` in your text editor and set your LLM API Key:

```env
MODEL_API_KEY="your_llm_api_key_here"
```

*(Optional: customize `MODEL_BASE_URL` or `MODEL_NAME` if using a provider other than DeepSeek, e.g. OpenAI, Groq, or OpenRouter).*

---

## Step 2: Backend Setup & Launch

```bash
# 1. Create and activate a Python virtual environment
python -m venv venv

# On Windows:
venv\Scripts\activate

# On macOS / Linux:
source venv/bin/activate

# 2. Install backend dependencies
pip install -r requirements.txt

# 3. Navigate into the api directory and start FastAPI
cd api
uvicorn main:app --port 8000 --reload
```

The backend server is now running at **`http://localhost:8000`**.  
Verify health by visiting [`http://localhost:8000/api/health`](http://localhost:8000/api/health).

---

## Step 3: Frontend Dashboard Launch

Open a **second terminal window** and run:

```bash
# 1. Navigate to the frontend directory
cd frontend

# 2. Install frontend dependencies
npm install

# 3. Start the Next.js development server
npm run dev
```

Open **[http://localhost:3000](http://localhost:3000)** in your browser.

---

## Step 4: Run Your First Reconciliation Flow

1. **Sign In**: Click **"Continue as Demo User"** (instant 1-click access) or use Google Sign-In.
2. **Upload**: Use your own transaction files or click **"Use Sample Dataset"** to load the bundled 200-invoice synthetic benchmark.
3. **Standardize**: Click **"Standardize Data"** to invoke AI entity resolution, date standardization, and currency conversions.
4. **Review**: Inspect standardized columns, adjust tolerance parameters, or edit rows.
5. **Results**: Execute the 3-way Hungarian matching engine. View the **Interactive Waterfall Chart**, **Invoice Realization Gauge**, **Donut Status Distribution**, and interact with **PennyWise AI Assistant** to draft dispute memos or generate emails.

---

## Alternative: Command Line Interface (CLI)

You can also run the core reconciliation engine entirely from the command line:

```bash
# 1. Standardize datasets into canonical format
python standardisation/standardizer.py INR

# 2. Execute 3-way Hungarian matching engine
python reconciliation/run_reconciliation.py
```

---

## Common Troubleshooting

| Issue | Cause | Resolution |
|---|---|---|
| `uvicorn: command not found` | Virtual environment is not activated | Run `venv\Scripts\activate` (Windows) or `source venv/bin/activate` (Mac/Linux). |
| `ModuleNotFoundError: No module named 'fastapi'` | Dependencies not installed in venv | Run `pip install -r requirements.txt`. |
| Port 8000 / 3000 already in use | Another process is holding the port | Free the port or run `uvicorn main:app --port 8001 --reload` and update `NEXT_PUBLIC_API_URL` in `.env`. |
| `MODEL_API_KEY missing` | `.env` not populated | Ensure `.env` is created in root directory with a valid `MODEL_API_KEY`. |
