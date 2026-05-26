// J. Reed Consults LLC — Express server v0.5
// Adds full-year projection, safe harbor, recommended-quarterly-payment, per-quarter pace.

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !SUPABASE_SERVICE_KEY) {
  console.error('Missing Supabase env vars. See .env.example.');
  process.exit(1);
}

const ALLOWED_EMAILS = (process.env.ALLOWED_EMAILS || '')
  .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);

const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const db = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname)));

const FED_BRACKETS_2026 = {
  single: [[0.10, 11925], [0.12, 48475], [0.22, 103350], [0.24, 197300], [0.32, 250525], [0.35, 626350], [0.37, Infinity]],
  mfj:    [[0.10, 23850], [0.12, 96950], [0.22, 206700], [0.24, 394600], [0.32, 501050], [0.35, 751600], [0.37, Infinity]]
};
const CA_BRACKETS_2026 = {
  single: [[0.01, 10756], [0.02, 25499], [0.04, 40245], [0.06, 55866], [0.08, 70606], [0.093, 360659], [0.103, 432787], [0.113, 721314], [0.123, Infinity]],
  mfj:    [[0.01, 21512], [0.02, 50998], [0.04, 80490], [0.06, 111732], [0.08, 141212], [0.093, 721318], [0.103, 865574], [0.113, 1442628], [0.123, Infinity]]
};
const FED_STD_DEDUCTION = { single: 15000, mfj: 30000 };
const CA_STD_DEDUCTION  = { single: 5540,  mfj: 11080 };
const SE_TAX_RATE = 0.153;
const SE_TAX_BASE = 0.9235;
const SS_WAGE_BASE_2026 = 176100; // approximate; adjust annually
const SEP_MAX = 70000;

function bracketTax(taxable, brackets) {
  if (taxable <= 0) return 0;
  let tax = 0, lower = 0;
  for (const [rate, upper] of brackets) {
    if (taxable <= lower) break;
    const slice = Math.min(taxable, upper) - lower;
    tax += slice * rate;
    lower = upper;
    if (taxable <= upper) break;
  }
  return tax;
}

function estimateTax(netSE, w2Income, spouseW2Income, filingStatus) {
  const se = Math.max(0, netSE);
  const w2 = Math.max(0, w2Income);
  const spouseW2 = Math.max(0, spouseW2Income);
  const householdNonSE = w2 + spouseW2;
  if (se <= 0 && householdNonSE <= 0) return { se_tax: 0, fed_tax: 0, ca_tax: 0, total: 0 };
  const fs = (filingStatus === 'mfj') ? 'mfj' : 'single';
  // SE tax — his alone. His W-2 (not spouse's) consumes his personal SS wage-base cap.
  const seBase = se * SE_TAX_BASE;
  const ssRoom = Math.max(0, SS_WAGE_BASE_2026 - w2);
  const ssTaxableSE = Math.min(seBase, ssRoom);
  const seTax = ssTaxableSE * 0.124 + seBase * 0.029;
  // Household income tax — brackets stack on combined AGI (his W-2 + spouse W-2 + his SE)
  const householdAgi = householdNonSE + se - seTax / 2;
  const fedTaxable = Math.max(0, householdAgi - FED_STD_DEDUCTION[fs]);
  const caTaxable  = Math.max(0, householdAgi - CA_STD_DEDUCTION[fs]);
  const householdFed = bracketTax(fedTaxable, FED_BRACKETS_2026[fs]);
  const householdCa  = bracketTax(caTaxable,  CA_BRACKETS_2026[fs]);
  // Allocate household income tax to him by income share. Spouse covers her own share.
  const totalIncome = householdNonSE + se;
  const hisShare = totalIncome > 0 ? (w2 + se) / totalIncome : 0;
  return {
    se_tax: seTax,
    fed_tax: householdFed * hisShare,
    ca_tax:  householdCa  * hisShare,
    total:   seTax + (householdFed + householdCa) * hisShare
  };
}

function sepRoom(netSE, seTax) {
  if (netSE <= 0) return 0;
  const netEarnings = netSE - seTax / 2;
  return Math.max(0, Math.min(netEarnings * 0.20, SEP_MAX));
}

const SETTINGS_DEFAULTS = {
  irs_mileage_rate: 0.725,
  cell_monthly: 0, cell_jreedconsults_pct: 25, cell_dwm_pct: 75,
  internet_monthly: 0, internet_jreedconsults_pct: 25, internet_dwm_pct: 75,
  home_office_sqft: 55, home_office_method: 'simplified',
  home_office_actual_annual: 0,
  home_office_jreedconsults_pct: 25, home_office_dwm_pct: 75,
  filing_status: 'single',
  expected_jreedconsults_income: 0, expected_dwm_income: 0,
  expected_w2_income: 0, expected_w2_federal_withholding: 0, expected_w2_state_withholding: 0,
  expected_spouse_w2_income: 0,
  prior_year_total_tax: 0, prior_year_agi: 0
};

async function getSettings(userId) {
  const { data } = await db.from('settings').select('*').eq('user_id', userId).maybeSingle();
  return data || Object.assign({ user_id: userId }, SETTINGS_DEFAULTS);
}

async function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'No token' });
  const { data, error } = await authClient.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Invalid token' });
  const email = (data.user.email || '').toLowerCase();
  if (!ALLOWED_EMAILS.includes(email)) return res.status(403).json({ error: 'Not authorized' });
  req.user = data.user;
  next();
}

app.use('/api', requireAuth);

// ---- Games ----
app.get('/api/games', async (req, res) => {
  const { data, error } = await db.from('games').select('*')
    .eq('user_id', req.user.id).order('game_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/games', async (req, res) => {
  const b = req.body;
  const { data, error } = await db.from('games').insert({
    user_id: req.user.id, game_date: b.game_date,
    gross_amount: b.gross_amount != null ? b.gross_amount : 1000,
    paid: !!b.paid, paid_date: b.paid_date || null,
    payment_method: b.payment_method || null, notes: b.notes || null
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/games/:id', async (req, res) => {
  const fields = {};
  ['game_date', 'gross_amount', 'paid', 'paid_date', 'payment_method', 'notes']
    .forEach(k => { if (k in req.body) fields[k] = req.body[k]; });
  const { data, error } = await db.from('games').update(fields)
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/games/:id', async (req, res) => {
  const { error } = await db.from('games').delete()
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---- Partner Pay ----
app.get('/api/partner_pay', async (req, res) => {
  const { data, error } = await db.from('partner_pay').select('*')
    .eq('user_id', req.user.id).order('pay_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/partner_pay', async (req, res) => {
  const b = req.body;
  const { data, error } = await db.from('partner_pay').insert({
    user_id: req.user.id, pay_date: b.pay_date, amount: b.amount,
    paid: b.paid != null ? !!b.paid : true,
    paid_date: b.paid_date || null, notes: b.notes || null
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/partner_pay/:id', async (req, res) => {
  const fields = {};
  ['pay_date', 'amount', 'paid', 'paid_date', 'notes']
    .forEach(k => { if (k in req.body) fields[k] = req.body[k]; });
  const { data, error } = await db.from('partner_pay').update(fields)
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/partner_pay/:id', async (req, res) => {
  const { error } = await db.from('partner_pay').delete()
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---- Mileage ----
app.get('/api/mileage', async (req, res) => {
  const { data, error } = await db.from('mileage').select('*')
    .eq('user_id', req.user.id).order('trip_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/mileage', async (req, res) => {
  const b = req.body;
  const { data, error } = await db.from('mileage').insert({
    user_id: req.user.id, trip_date: b.trip_date, miles: b.miles,
    tolls: b.tolls != null ? b.tolls : 0,
    business: b.business || 'jreedconsults',
    purpose: b.purpose || null, notes: b.notes || null
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/mileage/:id', async (req, res) => {
  const fields = {};
  ['trip_date', 'miles', 'tolls', 'business', 'purpose', 'notes']
    .forEach(k => { if (k in req.body) fields[k] = req.body[k]; });
  const { data, error } = await db.from('mileage').update(fields)
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/mileage/:id', async (req, res) => {
  const { error } = await db.from('mileage').delete()
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---- Expenses ----
app.get('/api/expenses', async (req, res) => {
  const { data, error } = await db.from('expenses').select('*')
    .eq('user_id', req.user.id).order('expense_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/expenses', async (req, res) => {
  const b = req.body;
  const { data, error } = await db.from('expenses').insert({
    user_id: req.user.id, expense_date: b.expense_date,
    vendor: b.vendor || null,
    business: b.business || 'jreedconsults',
    category: b.category || null, amount: b.amount,
    business_pct: b.business_pct != null ? b.business_pct : 100,
    notes: b.notes || null
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/expenses/:id', async (req, res) => {
  const fields = {};
  ['expense_date', 'vendor', 'business', 'category', 'amount', 'business_pct', 'notes']
    .forEach(k => { if (k in req.body) fields[k] = req.body[k]; });
  const { data, error } = await db.from('expenses').update(fields)
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/expenses/:id', async (req, res) => {
  const { error } = await db.from('expenses').delete()
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---- Tax payments ----
app.get('/api/tax_payments', async (req, res) => {
  const { data, error } = await db.from('tax_payments').select('*')
    .eq('user_id', req.user.id).order('payment_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/tax_payments', async (req, res) => {
  const b = req.body;
  const { data, error } = await db.from('tax_payments').insert({
    user_id: req.user.id, payment_date: b.payment_date, amount: b.amount,
    jurisdiction: b.jurisdiction, tax_year: b.tax_year,
    quarter: b.quarter || null, confirmation: b.confirmation || null,
    notes: b.notes || null
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/tax_payments/:id', async (req, res) => {
  const fields = {};
  ['payment_date', 'amount', 'jurisdiction', 'tax_year', 'quarter', 'confirmation', 'notes']
    .forEach(k => { if (k in req.body) fields[k] = req.body[k]; });
  const { data, error } = await db.from('tax_payments').update(fields)
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/tax_payments/:id', async (req, res) => {
  const { error } = await db.from('tax_payments').delete()
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---- SEP IRA ----
app.get('/api/sep_contributions', async (req, res) => {
  const { data, error } = await db.from('sep_contributions').select('*')
    .eq('user_id', req.user.id).order('contribution_date', { ascending: false });
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.post('/api/sep_contributions', async (req, res) => {
  const b = req.body;
  const { data, error } = await db.from('sep_contributions').insert({
    user_id: req.user.id, contribution_date: b.contribution_date,
    amount: b.amount, tax_year: b.tax_year, notes: b.notes || null
  }).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.patch('/api/sep_contributions/:id', async (req, res) => {
  const fields = {};
  ['contribution_date', 'amount', 'tax_year', 'notes']
    .forEach(k => { if (k in req.body) fields[k] = req.body[k]; });
  const { data, error } = await db.from('sep_contributions').update(fields)
    .eq('id', req.params.id).eq('user_id', req.user.id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});
app.delete('/api/sep_contributions/:id', async (req, res) => {
  const { error } = await db.from('sep_contributions').delete()
    .eq('id', req.params.id).eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ ok: true });
});

// ---- Settings ----
app.get('/api/settings', async (req, res) => {
  const s = await getSettings(req.user.id);
  res.json(s);
});
app.put('/api/settings', async (req, res) => {
  const b = req.body;
  const row = {
    user_id: req.user.id,
    irs_mileage_rate: b.irs_mileage_rate,
    cell_monthly: b.cell_monthly,
    cell_jreedconsults_pct: b.cell_jreedconsults_pct,
    cell_dwm_pct: b.cell_dwm_pct,
    internet_monthly: b.internet_monthly,
    internet_jreedconsults_pct: b.internet_jreedconsults_pct,
    internet_dwm_pct: b.internet_dwm_pct,
    home_office_sqft: b.home_office_sqft,
    home_office_method: b.home_office_method,
    home_office_actual_annual: b.home_office_actual_annual,
    home_office_jreedconsults_pct: b.home_office_jreedconsults_pct,
    home_office_dwm_pct: b.home_office_dwm_pct,
    filing_status: b.filing_status,
    expected_jreedconsults_income: b.expected_jreedconsults_income,
    expected_dwm_income: b.expected_dwm_income,
    expected_w2_income: b.expected_w2_income,
    expected_w2_federal_withholding: b.expected_w2_federal_withholding,
    expected_w2_state_withholding: b.expected_w2_state_withholding,
    expected_spouse_w2_income: b.expected_spouse_w2_income,
    prior_year_total_tax: b.prior_year_total_tax,
    prior_year_agi: b.prior_year_agi,
    updated_at: new Date().toISOString()
  };
  const { data, error } = await db.from('settings').upsert(row).select().single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ---- Summary (dashboard) ----
app.get('/api/summary', async (req, res) => {
  const year = parseInt(req.query.year, 10) || new Date().getFullYear();
  const business = req.query.business || 'combined';
  const yearStart = year + '-01-01';
  const yearEnd = year + '-12-31';

  const settings = await getSettings(req.user.id);

  const [gamesRes, ppRes, mileageRes, expRes, taxRes, sepRes] = await Promise.all([
    db.from('games').select('gross_amount, paid')
      .eq('user_id', req.user.id).gte('game_date', yearStart).lte('game_date', yearEnd),
    db.from('partner_pay').select('amount, paid')
      .eq('user_id', req.user.id).gte('pay_date', yearStart).lte('pay_date', yearEnd),
    db.from('mileage').select('miles, tolls, business')
      .eq('user_id', req.user.id).gte('trip_date', yearStart).lte('trip_date', yearEnd),
    db.from('expenses').select('amount, business_pct, business, category')
      .eq('user_id', req.user.id).gte('expense_date', yearStart).lte('expense_date', yearEnd),
    db.from('tax_payments').select('amount, jurisdiction, payment_date')
      .eq('user_id', req.user.id).eq('tax_year', year),
    db.from('sep_contributions').select('amount')
      .eq('user_id', req.user.id).eq('tax_year', year)
  ]);

  for (const r of [gamesRes, ppRes, mileageRes, expRes, taxRes, sepRes]) {
    if (r.error) return res.status(500).json({ error: r.error.message });
  }

  function businessTotals(b) {
    let income = 0, gameCount = 0, partnerPayCount = 0, collected = 0;
    if (b === 'jreedconsults' || b === 'combined') {
      const games = gamesRes.data || [];
      gameCount = games.length;
      income += games.reduce((s, g) => s + Number(g.gross_amount), 0);
      collected += games.filter(g => g.paid).reduce((s, g) => s + Number(g.gross_amount), 0);
    }
    if (b === 'dwm' || b === 'combined') {
      const pp = ppRes.data || [];
      partnerPayCount = pp.length;
      income += pp.reduce((s, p) => s + Number(p.amount), 0);
      collected += pp.filter(p => p.paid).reduce((s, p) => s + Number(p.amount), 0);
    }
    const trips = (mileageRes.data || []).filter(t => b === 'combined' || t.business === b);
    const miles = trips.reduce((s, t) => s + Number(t.miles), 0);
    const tolls = trips.reduce((s, t) => s + Number(t.tolls || 0), 0);
    const mileageDed = miles * Number(settings.irs_mileage_rate);

    const cellAnnual = Number(settings.cell_monthly) * 12;
    const internetAnnual = Number(settings.internet_monthly) * 12;
    const homeOfficeAnnual = settings.home_office_method === 'simplified'
      ? Math.min(Number(settings.home_office_sqft), 300) * 5
      : Number(settings.home_office_actual_annual);

    const jPct = (n) => Number(n) / 100;
    let cellPct, internetPct, hoPct;
    if (b === 'jreedconsults') {
      cellPct = jPct(settings.cell_jreedconsults_pct);
      internetPct = jPct(settings.internet_jreedconsults_pct);
      hoPct = jPct(settings.home_office_jreedconsults_pct);
    } else if (b === 'dwm') {
      cellPct = jPct(settings.cell_dwm_pct);
      internetPct = jPct(settings.internet_dwm_pct);
      hoPct = jPct(settings.home_office_dwm_pct);
    } else {
      cellPct = jPct(settings.cell_jreedconsults_pct) + jPct(settings.cell_dwm_pct);
      internetPct = jPct(settings.internet_jreedconsults_pct) + jPct(settings.internet_dwm_pct);
      hoPct = jPct(settings.home_office_jreedconsults_pct) + jPct(settings.home_office_dwm_pct);
    }
    const cellDed = cellAnnual * cellPct;
    const internetDed = internetAnnual * internetPct;
    const homeOfficeDed = homeOfficeAnnual * hoPct;

    const expRows = (expRes.data || []).filter(e => b === 'combined' || e.business === b);
    const otherExpenses = expRows.reduce((s, e) => s + Number(e.amount) * Number(e.business_pct) / 100, 0);

    const totalDeductions = mileageDed + tolls + cellDed + internetDed + homeOfficeDed + otherExpenses;
    return {
      income, gameCount, partnerPayCount, collected,
      miles, tolls, mileageDed,
      cellDed, internetDed, homeOfficeDed, otherExpenses,
      totalDeductions, netIncome: income - totalDeductions
    };
  }

  const filtered = businessTotals(business);
  const combined = businessTotals('combined');

  // ---- Full-year projection (combined, used for tax planning) ----
  const expectedTotal = Number(settings.expected_jreedconsults_income) + Number(settings.expected_dwm_income);
  const currentYear = new Date().getFullYear();
  const isCurrentYear = year === currentYear;
  const usingProjection = isCurrentYear && expectedTotal > 0;

  let projIncome, projMileage, projTolls, projOther, projDeductions, projNetSE;
  if (usingProjection) {
    const today = new Date();
    const yStart = new Date(year, 0, 1);
    const yEnd = new Date(year, 11, 31, 23, 59, 59);
    const daysInYear = Math.ceil((yEnd - yStart) / 86400000);
    const daysElapsed = Math.min(daysInYear, Math.max(1, Math.ceil((today - yStart) / 86400000)));
    const pace = daysInYear / daysElapsed;
    projIncome = expectedTotal;
    projMileage = combined.mileageDed * pace;
    projTolls = combined.tolls * pace;
    projOther = combined.otherExpenses * pace;
    projDeductions = projMileage + projTolls + combined.cellDed + combined.internetDed + combined.homeOfficeDed + projOther;
    projNetSE = projIncome - projDeductions;
  } else {
    projIncome = combined.income;
    projMileage = combined.mileageDed;
    projTolls = combined.tolls;
    projOther = combined.otherExpenses;
    projDeductions = combined.totalDeductions;
    projNetSE = combined.netIncome;
  }

  // ---- W-2 inputs (annual projections) ----
  const w2Income = Number(settings.expected_w2_income) || 0;
  const w2FedWH = Number(settings.expected_w2_federal_withholding) || 0;
  const w2StateWH = Number(settings.expected_w2_state_withholding) || 0;
  const w2WHTotal = w2FedWH + w2StateWH;
  // Spouse W-2 — bracket stacking only; her withholding is her responsibility.
  const spouseW2Income = Number(settings.expected_spouse_w2_income) || 0;

  const projTax = estimateTax(projNetSE, w2Income, spouseW2Income, settings.filing_status);

  // ---- Tax payments and SEP ----
  const taxes = taxRes.data || [];
  const fedPaid = taxes.filter(t => t.jurisdiction === 'federal').reduce((s, t) => s + Number(t.amount), 0);
  const statePaid = taxes.filter(t => t.jurisdiction === 'state').reduce((s, t) => s + Number(t.amount), 0);
  const totalPaid = fedPaid + statePaid;

  const sepContributed = (sepRes.data || []).reduce((s, c) => s + Number(c.amount), 0);
  const sepLimit = sepRoom(projNetSE, projTax.se_tax);
  const sepRemaining = Math.max(0, sepLimit - sepContributed);

  // ---- Safe harbor ----
  const priorTax = Number(settings.prior_year_total_tax);
  const priorAgi = Number(settings.prior_year_agi);
  let safeHarborFloor = null;
  if (priorTax > 0) {
    const mult = priorAgi > 150000 ? 1.10 : 1.00;
    safeHarborFloor = priorTax * mult;
  }

  // ---- Quarterly due dates and pace ----
  const dues = [
    { num: 1, date: new Date(year, 3, 15) },
    { num: 2, date: new Date(year, 5, 15) },
    { num: 3, date: new Date(year, 8, 15) },
    { num: 4, date: new Date(year + 1, 0, 15) }
  ];
  const today = new Date();
  const nextDue = dues.find(d => d.date > today);

  // Recommended next payment: aim for cumulative target by next due, crediting
  // both quarterly estimates already paid AND W-2 withholding accrued pro-rata.
  let recommendedNext = 0;
  let recommendedDueDate = null;
  let recommendedQuarter = null;
  if (nextDue) {
    const cumTarget = projTax.total * (nextDue.num / 4);
    const w2Accrued = w2WHTotal * (nextDue.num / 4);
    recommendedNext = Math.max(0, cumTarget - totalPaid - w2Accrued);
    recommendedDueDate = nextDue.date.toISOString().split('T')[0];
    recommendedQuarter = nextDue.num;
  }

  // Set-aside % — of every SE-income dollar, how much to bank for taxes that
  // W-2 withholding doesn't already cover.
  const taxAfterW2 = Math.max(0, projTax.total - w2WHTotal);
  const setAsidePct = projIncome > 0 ? (taxAfterW2 / projIncome) : 0;

  // Total credits: W-2 withholding (full year) + estimates paid YTD
  const totalCredits = w2WHTotal + totalPaid;
  const remainingFullYear = Math.max(0, projTax.total - totalCredits);

  // Per-quarter pace — W-2 withholding accrues evenly across the year per IRS rules
  const quarterlyPace = dues.map(d => {
    const target = projTax.total * (d.num / 4);
    const w2Accrued = w2WHTotal * (d.num / 4);
    const estimatesPaid = taxes
      .filter(p => new Date(p.payment_date) <= d.date)
      .reduce((s, p) => s + Number(p.amount), 0);
    const paidByDate = estimatesPaid + w2Accrued;
    return {
      quarter: d.num,
      due_date: d.date.toISOString().split('T')[0],
      target_cumulative: target,
      paid_cumulative: paidByDate,
      gap: Math.max(0, target - paidByDate),
      is_past: d.date < today,
      on_track: paidByDate >= target - 0.01
    };
  });

  res.json({
    year, business,
    mileage_rate: Number(settings.irs_mileage_rate),
    filing_status: settings.filing_status,
    using_projection: usingProjection,

    // Filtered (business-specific YTD)
    game_count: filtered.gameCount,
    partner_pay_count: filtered.partnerPayCount,
    gross_income: filtered.income,
    collected_income: filtered.collected,
    total_miles: filtered.miles,
    mileage_deduction: filtered.mileageDed,
    total_tolls: filtered.tolls,
    cell_deduction: filtered.cellDed,
    internet_deduction: filtered.internetDed,
    home_office_deduction: filtered.homeOfficeDed,
    other_expenses: filtered.otherExpenses,
    total_deductions: filtered.totalDeductions,
    estimated_net: filtered.netIncome,

    // Combined YTD
    combined_net_se: combined.netIncome,

    // Projected full-year (combined)
    projected_income: projIncome,
    projected_deductions: projDeductions,
    projected_net_se: projNetSE,
    projected_w2_income: w2Income,
    projected_w2_federal_withholding: w2FedWH,
    projected_w2_state_withholding: w2StateWH,
    projected_w2_withholding: w2WHTotal,
    projected_total_income: projIncome + w2Income,
    projected_se_tax: projTax.se_tax,
    projected_fed_tax: projTax.fed_tax,
    projected_ca_tax: projTax.ca_tax,
    projected_total_tax: projTax.total,
    total_credits: totalCredits,
    remaining_full_year: remainingFullYear,

    // Safe harbor
    safe_harbor_floor: safeHarborFloor,

    // Tax payments
    federal_taxes_paid: fedPaid,
    state_taxes_paid: statePaid,
    total_taxes_paid: totalPaid,

    // Recommendations
    recommended_next_payment: recommendedNext,
    recommended_due_date: recommendedDueDate,
    recommended_quarter: recommendedQuarter,
    set_aside_pct: setAsidePct,

    quarterly_pace: quarterlyPace,

    // SEP IRA
    sep_contributed: sepContributed,
    sep_limit: sepLimit,
    sep_remaining: sepRemaining,

    next_quarterly_due: recommendedDueDate
  });
});

app.listen(PORT, () => console.log('jreedconsults listening on :' + PORT));
