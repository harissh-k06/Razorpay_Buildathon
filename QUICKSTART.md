# PennyWise Quick Start Guide

Welcome to **PennyWise - Your Khata Agent**. Follow this guide to get the platform up and running locally.

---

## Prerequisites

- **Python 3.10+**
- **Node.js 18+** and **npm** / **pnpm**
- An API Key for any **OpenAI-Compatible LLM** (e.g. DeepSeek, OpenAI, Groq, OpenRouter)

---

## Step 1: Clone and Configure Environment

```bash
# 1. Clone the repository
git clone https://github.com/harissh-k06/Razorpay_Buildathon.git
cd Razorpay-2

# 2. Copy the environment configuration template
cp .env.example .env
```

Open `.env` in your text editor and provide your LLM API Key:

```env
MODEL_API_KEY="your_llm_api_key_here"
```
*(Optional: customize `MODEL_BASE_URL` or `MODEL_NAME` if using a provider other than DeepSeek).*

---

## Step 2: Backend Setup

```bash
# 1. Create and activate a Python virtual environment
python -m venv venv

# On Windows:
venv\Scripts\activate

# On macOS/Linux:
source venv/bin/activate

# 2. Install all backend dependencies
pip install -r requirements.txt

# 3. Start the FastAPI backend server
uvicorn api.main:app --port 8000 --reload
```

The backend API will be live at `http://localhost:8000`.

---

## Step 3: Frontend Dashboard Setup

In a new terminal window:

```bash
# 1. Navigate to the frontend directory
cd frontend

# 2. Install frontend dependencies
npm install

# 3. Start the Next.js development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Step 4: Run Reconciliation Pipeline

You can run the full end-to-end reconciliation flow in either of two ways:

### Option A: Via Dashboard (Zero CLI required)
1. Navigate to `http://localhost:3000`.
2. Click **Reconciliation** -> **Upload** (or use the pre-loaded synthetic datasets).
3. Click **Standardize Data** -> **Run Reconciliation**.
4. View real-time analytics in **Results** and interact with **PennyWise AI Assistant**.

### Option B: Via Command Line
```bash
# 1. Standardize datasets into canonical format
python standardisation/standardizer.py INR

# 2. Execute 3-way Hungarian matching engine
python reconciliation/run_reconciliation.py
```

---

## Next Steps
- Read [ARCHITECTURE.md](ARCHITECTURE.md) for a deep dive into the 3-way matching algorithms, FastMCP server, and Agentic Controller.
