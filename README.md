# SAP Order-to-Cash Graph System

A context graph system with a natural language query interface for exploring SAP Order-to-Cash data. Nodes represent business documents and edges represent the relationships between them.

---

## Architecture

The backend is Node/Express with two routes: one builds the graph, one handles chat. Frontend is Next.js with a force-directed graph left and chat panel right.

Queries run through a two-step pipeline. First, the backend scans the message for SAP document IDs and looks them up in SQLite before the LLM sees anything. Then it sends resolved entities, the full schema, and the question to the LLM to generate SQL. SQL runs, results go back to the LLM for a plain-English answer. Result rows map to node IDs for graph highlighting.

---

## Database choice

SQLite. The dataset fits in memory, queries complete under 5ms, deploys as a single file. Graph edges are derived from FK relationships at query time rather than stored explicitly.

PostgreSQL would be the right choice at scale, but for this dataset size SQLite is optimal.

---

## LLM prompting strategy

SQL generation uses few-shot prompting. The system prompt contains the full entity relationship model and nine verified SQL examples covering common query patterns. The model matches the question to the closest example and adapts it.

This outperforms schema-only prompting because SAP column naming is non-obvious. The payments-to-billing join goes through clearingAccountingDocument = accountingDocument, not a referenceDocument column that does not exist. Hardcoding the correct join in an example means the model copies it instead of guessing.

Temperature is 0.0 for SQL generation. Entity resolution runs before the LLM: regex scans the message for SAP IDs, looks them up, and injects real metadata as grounded context. Last six conversation turns are passed for multi-turn support.

---

## Guardrails

Three layers. Regex blocks obvious off-topic queries immediately. Short messages with no SAP terms are rejected. The system prompt instructs the model to return a structured off-topic flag for anything unrelated.

Answer generation is told to report only numbers from the results, never calculate independently, and say no records found on empty results rather than fabricating data. SQL is read-only — DROP, DELETE, UPDATE, INSERT, ALTER are prohibited. Results capped at 50 rows.

---

## Running locally
```bash
cd backend && npm install
echo "GROQ_API_KEY=your_key" > .env && echo "PORT=3001" >> .env
cd .. && node scripts/seed.js
cd backend && node index.js
```

New terminal:
```bash
cd frontend && npm install
echo "NEXT_PUBLIC_API_URL=http://localhost:3001" > .env.local
npm run dev
```

Groq API keys at console.groq.com.

---

## Stack

Next.js, Express, SQLite, react-force-graph-2d, Groq llama-3.3-70b-versatile
