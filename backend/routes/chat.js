const express = require('express');
const router = express.Router();
const db = require('../db');
const Groq = require('groq-sdk');
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ─── Schema introspection (runs once at startup) ───────────────────────────
let SCHEMA_CACHE = null;
function getSchema() {
  if (SCHEMA_CACHE) return SCHEMA_CACHE;
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r => r.name);
  let s = '';
  for (const t of tables) {
    try {
      const cols = db.prepare(`PRAGMA table_info("${t}")`).all().map(c => c.name);
      s += `\n"${t}": ${cols.join(', ')}`;
    } catch {}
  }
  SCHEMA_CACHE = s;
  return s;
}

// ─── Entity Relationship Model ─────────────────────────────────────────────
const ER_MODEL = `
ENTITIES:
  business_partners:           businessPartner(PK), businessPartnerName, businessPartnerCategory, customer
  sales_order_headers:         salesOrder(PK), soldToParty→business_partners.businessPartner, totalNetAmount, overallDeliveryStatus, transactionCurrency, creationDate, customerPaymentTerms, salesOrderType
  sales_order_items:           salesOrder(FK), salesOrderItem, material, requestedQuantity, netAmount, materialGroup, plant
  outbound_delivery_headers:   deliveryDocument(PK), actualGoodsMovementDate, plannedGoodsIssueDate, shippingPoint
  outbound_delivery_items:     deliveryDocument(FK), deliveryDocumentItem, referenceSdDocument→sales_order_headers.salesOrder, referenceSdDocumentItem, material, actualDeliveryQuantity, plant
  billing_document_headers:    billingDocument(PK), soldToParty→business_partners.businessPartner, billingDocumentType, billingDocumentDate, totalNetAmount, transactionCurrency, payerParty, accountingDocument, cancelledBillingDocument
  billing_document_items:      billingDocument(FK), billingDocumentItem, referenceSdDocument→outbound_delivery_headers.deliveryDocument, material, billingQuantity, netAmount
  billing_document_cancellations: billingDocument, cancelledBillingDocument, cancellationDate
  journal_entry_items:         accountingDocument, accountingDocumentItem, referenceDocument→billing_document_headers.billingDocument, glAccount, amountInCompanyCodeCurrency, companyCodeCurrency, postingDate, fiscalYear, companyCode, customer
  payments:                    accountingDocument, accountingDocumentItem, clearingAccountingDocument→billing_document_headers.accountingDocument, amountInCompanyCodeCurrency, companyCodeCurrency, clearingDate, customer, salesDocument, invoiceReference

CANONICAL JOINS (copy exactly — do not modify):
  customers→orders:    business_partners bp JOIN sales_order_headers soh ON bp.businessPartner = soh.soldToParty
  orders→deliveries:   sales_order_headers soh JOIN outbound_delivery_items odi ON odi.referenceSdDocument = soh.salesOrder
  deliveries→billing:  outbound_delivery_headers odh JOIN billing_document_items bdi ON bdi.referenceSdDocument = odh.deliveryDocument
  billing→journal:     billing_document_headers bdh JOIN journal_entry_items ji ON ji.referenceDocument = bdh.billingDocument
  billing→payments:    billing_document_headers bdh JOIN payments p ON p.clearingAccountingDocument = bdh.accountingDocument
  NOT billed:          WHERE odh.deliveryDocument NOT IN (SELECT DISTINCT referenceSdDocument FROM billing_document_items WHERE referenceSdDocument != '')

SQLITE: All TEXT columns. Use CAST(col AS REAL) for math. LIMIT 50.
`;

// ─── Few-shot examples ─────────────────────────────────────────────────────
const FEW_SHOT = `
SOLVED EXAMPLES — apply same patterns to new questions:

Q: Top 5 customers by total order value
SQL: SELECT bp.businessPartner, bp.businessPartnerName, COUNT(soh.salesOrder) AS order_count, SUM(CAST(soh.totalNetAmount AS REAL)) AS total_value FROM business_partners bp JOIN sales_order_headers soh ON bp.businessPartner = soh.soldToParty GROUP BY bp.businessPartner, bp.businessPartnerName ORDER BY total_value DESC LIMIT 5

Q: Trace full flow of billing document 91150187
SQL: SELECT bdh.billingDocument, bdh.billingDocumentType, bdh.billingDocumentDate, bdh.totalNetAmount, bdh.transactionCurrency, bdh.soldToParty, bp.businessPartnerName, bdi.referenceSdDocument AS deliveryDocument, odi.referenceSdDocument AS salesOrder, ji.accountingDocument, ji.amountInCompanyCodeCurrency AS journalAmount, p.accountingDocument AS paymentDoc, p.amountInCompanyCodeCurrency AS paymentAmount, p.clearingDate FROM billing_document_headers bdh LEFT JOIN business_partners bp ON bp.businessPartner = bdh.soldToParty LEFT JOIN billing_document_items bdi ON bdi.billingDocument = bdh.billingDocument LEFT JOIN outbound_delivery_items odi ON odi.deliveryDocument = bdi.referenceSdDocument LEFT JOIN journal_entry_items ji ON ji.referenceDocument = bdh.billingDocument LEFT JOIN payments p ON p.clearingAccountingDocument = bdh.accountingDocument WHERE bdh.billingDocument = '91150187' LIMIT 50

Q: Find sales orders that were delivered but never billed
SQL: SELECT soh.salesOrder, soh.soldToParty, soh.totalNetAmount, soh.creationDate, odh.deliveryDocument, odh.actualGoodsMovementDate FROM sales_order_headers soh JOIN outbound_delivery_items odi ON odi.referenceSdDocument = soh.salesOrder JOIN outbound_delivery_headers odh ON odh.deliveryDocument = odi.deliveryDocument WHERE odh.deliveryDocument NOT IN (SELECT DISTINCT referenceSdDocument FROM billing_document_items WHERE referenceSdDocument IS NOT NULL AND referenceSdDocument != '') LIMIT 50

Q: Which products have the most billing documents
SQL: SELECT material, COUNT(DISTINCT billingDocument) AS billing_count FROM billing_document_items WHERE material IS NOT NULL AND material != '' GROUP BY material ORDER BY billing_count DESC LIMIT 20

Q: Total payments received
SQL: SELECT companyCodeCurrency, COUNT(*) AS payment_count, SUM(CAST(amountInCompanyCodeCurrency AS REAL)) AS total_amount FROM payments WHERE CAST(amountInCompanyCodeCurrency AS REAL) > 0 GROUP BY companyCodeCurrency

Q: Show cancelled billing documents
SQL: SELECT bdc.billingDocument, bdc.cancelledBillingDocument, bdc.cancellationDate, bdh.totalNetAmount, bdh.billingDocumentDate, bp.businessPartnerName FROM billing_document_cancellations bdc LEFT JOIN billing_document_headers bdh ON bdh.billingDocument = bdc.billingDocument LEFT JOIN business_partners bp ON bp.businessPartner = bdh.soldToParty LIMIT 50

Q: Average order value per customer
SQL: SELECT bp.businessPartner, bp.businessPartnerName, COUNT(soh.salesOrder) AS order_count, ROUND(AVG(CAST(soh.totalNetAmount AS REAL)),2) AS avg_value, SUM(CAST(soh.totalNetAmount AS REAL)) AS total_value FROM business_partners bp JOIN sales_order_headers soh ON bp.businessPartner = soh.soldToParty GROUP BY bp.businessPartner, bp.businessPartnerName ORDER BY total_value DESC LIMIT 20

Q: Show all sales orders with their delivery and billing status
SQL: SELECT soh.salesOrder, soh.soldToParty, soh.totalNetAmount, soh.overallDeliveryStatus, soh.creationDate, CASE WHEN odh.deliveryDocument IS NOT NULL THEN 'Delivered' ELSE 'Not Delivered' END AS deliveryStatus, CASE WHEN bdh.billingDocument IS NOT NULL THEN 'Billed' ELSE 'Not Billed' END AS billingStatus FROM sales_order_headers soh LEFT JOIN outbound_delivery_items odi ON odi.referenceSdDocument = soh.salesOrder LEFT JOIN outbound_delivery_headers odh ON odh.deliveryDocument = odi.deliveryDocument LEFT JOIN billing_document_items bdi ON bdi.referenceSdDocument = odh.deliveryDocument LEFT JOIN billing_document_headers bdh ON bdh.billingDocument = bdi.billingDocument GROUP BY soh.salesOrder ORDER BY soh.creationDate DESC LIMIT 50
`;

// ─── Entity Resolver ───────────────────────────────────────────────────────
function resolveEntities(question) {
  const resolved = [];
  const checks = [
    { regex: /\b(3[12]\d{7})\b/g,  table: 'business_partners',       col: 'businessPartner',  type: 'business_partner' },
    { regex: /\b(74\d{4})\b/g,     table: 'sales_order_headers',      col: 'salesOrder',       type: 'sales_order' },
    { regex: /\b(9[01]\d{6,7})\b/g, table: 'billing_document_headers', col: 'billingDocument', type: 'billing_document' },
    { regex: /\b(8\d{7})\b/g,      table: 'outbound_delivery_headers', col: 'deliveryDocument', type: 'delivery' },
  ];
  // Name-based lookup for business partners
  try {
    const allBPs = db.prepare('SELECT * FROM business_partners').all();
    for (const bp of allBPs) {
      if (bp.businessPartnerName) {
        const shortName = bp.businessPartnerName.split(',')[0].toLowerCase();
        if (shortName.length > 3 && question.toLowerCase().includes(shortName)) {
          if (!resolved.find(r => r.businessPartner === bp.businessPartner)) {
            resolved.push({ type: 'business_partner', ...bp });
          }
        }
      }
    }
  } catch(e) {}

  for (const { regex, table, col, type } of checks) {
    for (const id of [...new Set(question.match(regex) || [])]) {
      try {
        const row = db.prepare(`SELECT * FROM "${table}" WHERE "${col}" = ? LIMIT 1`).get(id);
        if (row) resolved.push({ type, ...row });
      } catch {}
    }
  }
  return resolved;
}

const OFF_TOPIC = /\b(weather|cricket|football|movie|bollywood|prime minister|capital city|teach me|javascript tutorial|history of rome|who invented|recipe for|how to cook|man in india|woman|gender|age|religion|country|population|average.*person|person.*average)\b/i;

// ─── POST /api/chat ────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { message, history = [] } = req.body;
  if (!message) return res.status(400).json({ error: 'Message required' });

  // Also reject very short non-question messages
  if (message.trim().split(' ').length <= 3 && !/order|invoice|billing|payment|delivery|customer|product|sales|material|document|partner/i.test(message)) {
    return res.json({ answer: 'Please ask a specific question about the SAP Order-to-Cash data — sales orders, deliveries, invoices, payments, or customers.', sql: null, data: null, off_topic: true });
  }
  if (OFF_TOPIC.test(message)) {
    return res.json({ answer: 'This system only answers questions about the SAP Order-to-Cash dataset. Try asking about sales orders, deliveries, billing documents, payments, or customers.', sql: null, data: null, off_topic: true });
  }

  const schema = getSchema();
  const entities = resolveEntities(message);
  const entityContext = entities.length > 0
    ? `\nRESOLVED ENTITIES (use these exact IDs in WHERE clauses — do not guess):\n${entities.map(e => JSON.stringify(e)).join('\n')}\n`
    : '';

  // Build conversation context for multi-turn
  const conversationContext = history.length > 0
    ? `\nCONVERSATION HISTORY (for context only — do not repeat previous answers):\n${history.slice(-4).map(h => `${h.role}: ${h.content}`).join('\n')}\n`
    : '';

  try {
    // ── Step 1: Generate SQL ──
    const sqlRes = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You generate SQLite SQL for SAP Order-to-Cash data.

${ER_MODEL}

${FEW_SHOT}

${entityContext}
${conversationContext}

OUTPUT: JSON only — {"sql":"SELECT...","explanation":"..."}
If off-topic: {"off_topic":true,"message":"..."}
No markdown. No backticks. JSON only.
RULES: Only use defined columns/joins. CAST for math. Include PK/FK in SELECT. LIMIT 50.`
        },
        { role: 'user', content: message }
      ],
      temperature: 0.0,
      max_tokens: 700,
    });

    let raw = sqlRes.choices[0].message.content.trim()
      .replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return res.json({ answer: "I couldn't generate a query for that. Try rephrasing.", sql: null, data: null });

    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch { return res.json({ answer: "I couldn't parse that query. Try rephrasing.", sql: null, data: null }); }

    if (parsed.off_topic) return res.json({ answer: parsed.message, sql: null, data: null, off_topic: true });

    // ── Step 2: Execute SQL ──
    let queryData = null, queryError = null;
    if (parsed.sql) {
      try { queryData = db.prepare(parsed.sql).all(); }
      catch (err) {
        queryError = err.message;
        console.error('SQL Error:', err.message, '\nSQL:', parsed.sql);
      }
    }

    // ── Step 3: Natural language answer ──
    const answerRes = await groq.chat.completions.create({
      model: 'llama-3.3-70b-versatile',
      messages: [{
        role: 'user',
        content: `You are a concise SAP data analyst. Answer the question using only the data provided.

Question: "${message}"
${entities.length ? `Known entities: ${JSON.stringify(entities.map(e => ({ type: e.type, id: e.businessPartner || e.salesOrder || e.billingDocument || e.deliveryDocument, name: e.businessPartnerName })))}` : ''}
${queryError
  ? `Query failed: ${queryError}. Explain simply what went wrong.`
  : `Results (${queryData?.length || 0} rows): ${JSON.stringify(queryData?.slice(0, 15))}`
}

Rules:
- ONLY report numbers that literally appear in the results JSON
- If 0 rows: say ONLY "No matching records found in the dataset."
- NEVER calculate or derive numbers yourself — just read from results
- NEVER do arithmetic on results — if asked for averages/totals that aren't in results, say the data shows X rows with these values and list them
- 2-3 sentences max`
      }],
      temperature: 0.1,
      max_tokens: 300,
    });

    res.json({
      answer: answerRes.choices[0].message.content.trim(),
      sql: parsed.sql,
      data: queryData?.slice(0, 50) || null,
      rowCount: queryData?.length || 0,
      error: queryError,
      entities,
    });

  } catch (err) {
    console.error('Chat error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;