const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', (req, res) => {
  try {
    const nodes = [];
    const links = [];
    const seen = new Set();

    const addNode = (id, type, label, data = {}) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      nodes.push({ id, type, label, ...data });
    };

    const addLink = (source, target, type) => {
      if (seen.has(source) && seen.has(target)) {
        links.push({ source, target, type });
      }
    };

    // ── Customers ──────────────────────────────────────────────────
    const bps = db.prepare('SELECT * FROM business_partners').all();
    for (const b of bps) {
      addNode(`BP-${b.businessPartner}`, 'Customer', b.businessPartnerName || `Customer ${b.businessPartner}`, {
        businessPartner: b.businessPartner,
        name: b.businessPartnerName,
        category: b.businessPartnerCategory,
      });
    }

    // ── Sales Orders ───────────────────────────────────────────────
    const orders = db.prepare('SELECT * FROM sales_order_headers LIMIT 300').all();
    for (const o of orders) {
      addNode(`SO-${o.salesOrder}`, 'SalesOrder', `SO ${o.salesOrder}`, {
        salesOrder: o.salesOrder,
        amount: o.totalNetAmount,
        currency: o.transactionCurrency,
        status: o.overallDeliveryStatus,
        date: o.creationDate?.slice(0, 10),
        customer: o.soldToParty,
      });
      addLink(`BP-${o.soldToParty}`, `SO-${o.salesOrder}`, 'PLACED');
    }

    // ── Deliveries ─────────────────────────────────────────────────
    const deliveries = db.prepare('SELECT * FROM outbound_delivery_headers LIMIT 300').all();
    for (const d of deliveries) {
      addNode(`DEL-${d.deliveryDocument}`, 'Delivery', `DEL ${d.deliveryDocument}`, {
        deliveryDocument: d.deliveryDocument,
        deliveryDate: d.actualGoodsMovementDate?.slice(0, 10) || d.plannedGoodsIssueDate?.slice(0, 10),
        shippingPoint: d.shippingPoint,
      });
    }

    // ── Delivery Items → link Orders to Deliveries ─────────────────
    const delItems = db.prepare('SELECT DISTINCT deliveryDocument, referenceSdDocument FROM outbound_delivery_items').all();
    for (const di of delItems) {
      addLink(`SO-${di.referenceSdDocument}`, `DEL-${di.deliveryDocument}`, 'DELIVERED_BY');
    }

    // ── Billing Documents ──────────────────────────────────────────
    const billings = db.prepare('SELECT * FROM billing_document_headers LIMIT 300').all();
    for (const b of billings) {
      addNode(`BILL-${b.billingDocument}`, 'BillingDocument', `INV ${b.billingDocument}`, {
        billingDocument: b.billingDocument,
        amount: b.totalNetAmount,
        currency: b.transactionCurrency,
        date: b.billingDocumentDate?.slice(0, 10),
        type: b.billingDocumentType,
        accountingDocument: b.accountingDocument,
        customer: b.soldToParty,
      });
    }

    // ── Billing Items → link Deliveries to Billing ─────────────────
    // CORRECT column: referenceSdDocument (not referenceDocument)
    const billItems = db.prepare('SELECT DISTINCT billingDocument, referenceSdDocument FROM billing_document_items').all();
    for (const bi of billItems) {
      addLink(`DEL-${bi.referenceSdDocument}`, `BILL-${bi.billingDocument}`, 'BILLED_AS');
    }

    // ── Journal Entries ────────────────────────────────────────────
    const journals = db.prepare('SELECT * FROM journal_entry_items LIMIT 300').all();
    for (const j of journals) {
      const jId = `JE-${j.accountingDocument}-${j.accountingDocumentItem || '1'}`;
      addNode(jId, 'JournalEntry', `JE ${j.accountingDocument}`, {
        accountingDocument: j.accountingDocument,
        amount: j.amountInCompanyCodeCurrency,
        currency: j.companyCodeCurrency,
        postingDate: j.postingDate?.slice(0, 10),
        glAccount: j.glAccount,
        referenceDocument: j.referenceDocument,
      });
      // Link billing → journal via referenceDocument = billingDocument
      if (j.referenceDocument) {
        addLink(`BILL-${j.referenceDocument}`, jId, 'POSTED_TO');
      }
    }

    // ── Payments ───────────────────────────────────────────────────
    // CORRECT join: payments.clearingAccountingDocument = billing_document_headers.accountingDocument
    // Build a map of accountingDocument → billingDocument
    const billAccMap = {};
    for (const b of billings) {
      if (b.accountingDocument) billAccMap[b.accountingDocument] = b.billingDocument;
    }

    const payments = db.prepare('SELECT * FROM payments LIMIT 300').all();
    for (const p of payments) {
      const pId = `PAY-${p.accountingDocument}-${p.accountingDocumentItem || '1'}`;
      addNode(pId, 'Payment', `PAY ${p.accountingDocument}`, {
        accountingDocument: p.accountingDocument,
        amount: p.amountInCompanyCodeCurrency,
        currency: p.companyCodeCurrency,
        clearingDate: p.clearingDate?.slice(0, 10),
        clearingAccountingDocument: p.clearingAccountingDocument,
        customer: p.customer,
      });
      // Link via clearingAccountingDocument → billing's accountingDocument
      if (p.clearingAccountingDocument && billAccMap[p.clearingAccountingDocument]) {
        addLink(`BILL-${billAccMap[p.clearingAccountingDocument]}`, pId, 'PAID_BY');
      }
    }

    // ── Deduplicate links ──────────────────────────────────────────
    const linkSet = new Set();
    const uniqueLinks = links.filter(l => {
      const key = `${l.source}|${l.target}|${l.type}`;
      if (linkSet.has(key)) return false;
      linkSet.add(key);
      return true;
    });

    res.json({ nodes, links: uniqueLinks });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/graph/node/:id ────────────────────────────────────────────
router.get('/node/:id', (req, res) => {
  const { id } = req.params;
  let data = null;
  try {
    const docId = id.replace(/^[A-Z]+-/, '').replace(/-\d+$/, '');
    if (id.startsWith('SO-'))   data = db.prepare('SELECT * FROM sales_order_headers WHERE salesOrder = ?').get(docId);
    if (id.startsWith('DEL-'))  data = db.prepare('SELECT * FROM outbound_delivery_headers WHERE deliveryDocument = ?').get(docId);
    if (id.startsWith('BILL-')) data = db.prepare('SELECT * FROM billing_document_headers WHERE billingDocument = ?').get(docId);
    if (id.startsWith('JE-'))   data = db.prepare('SELECT * FROM journal_entry_items WHERE accountingDocument = ? LIMIT 1').get(docId);
    if (id.startsWith('PAY-'))  data = db.prepare('SELECT * FROM payments WHERE accountingDocument = ? LIMIT 1').get(docId);
    if (id.startsWith('BP-'))   data = db.prepare('SELECT * FROM business_partners WHERE businessPartner = ? LIMIT 1').get(docId);
    res.json({ id, data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/graph/material/:material — nodes linked to a product ──────
router.get('/material/:material', (req, res) => {
  try {
    const { material } = req.params;
    const billDocs = db.prepare('SELECT DISTINCT billingDocument FROM billing_document_items WHERE material = ?').all(material);
    const orderDocs = db.prepare('SELECT DISTINCT salesOrder FROM sales_order_items WHERE material = ?').all(material);
    const nodeIds = [
      ...billDocs.map(r => `BILL-${r.billingDocument}`),
      ...orderDocs.map(r => `SO-${r.salesOrder}`),
    ];
    res.json({ nodeIds });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;