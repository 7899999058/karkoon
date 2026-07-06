import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Mic, Check, ChevronRight, ChevronLeft, Download, Share2, MessageCircle, Mail, Copy, X,
  Plus, Search, Scale, BarChart3, BookOpen, Sparkles, Calendar, ArrowRight, RotateCcw,
  Settings, Lock, Building2, Briefcase, Heart, User, Receipt, Layers, ArrowLeftRight, Box, Tag, Camera, Pencil, Wallet
} from "lucide-react";

/* ===== Brand ===== */
const BURGUNDY = "#8A1E3C", BURGUNDY_DK = "#6E1430", GOLD = "#E0A82E", GOLD_BRIGHT = "#EFC34B";
const PAPER = "#F6F2EF", INK = "#241318", TINT = "#F3E1E7", SOFT = "#FBEFF2";
const HAIR = "#E9E0DC", EXP = "#C0492F", INC = "#1B7A60";

/* ===== Tally Prime groups (all 28 defaults) ===== */
const GROUPS = {
  "Capital Account": "liability", "Reserves & Surplus": "liability", "Loans (Liability)": "liability",
  "Secured Loans": "liability", "Unsecured Loans": "liability", "Bank OD A/c": "liability",
  "Current Liabilities": "liability", "Duties & Taxes": "liability", "Provisions": "liability",
  "Sundry Creditors": "liability", "Branch / Divisions": "liability", "Suspense A/c": "liability",
  "Fixed Assets": "asset", "Investments": "asset", "Current Assets": "asset", "Bank Accounts": "asset",
  "Cash-in-Hand": "asset", "Deposits (Asset)": "asset", "Loans & Advances (Asset)": "asset",
  "Stock-in-Hand": "asset", "Sundry Debtors": "asset", "Misc. Expenses (ASSET)": "asset",
  "Sales Accounts": "income", "Direct Incomes": "income", "Indirect Incomes": "income",
  "Purchase Accounts": "expense", "Direct Expenses": "expense", "Indirect Expenses": "expense",
};
const GROUP_NAMES = Object.keys(GROUPS);
const nature = (g) => GROUPS[g] || "asset";

/* ===== Account-type config ===== */
const TYPE_CFG = {
  business:   { label: "Business",   income: "Sales",             incomeGroup: "Sales Accounts",   capital: "Capital A/c",  plTitle: "Profit & Loss" },
  profession: { label: "Profession", income: "Professional Fees", incomeGroup: "Direct Incomes",    capital: "Capital A/c",  plTitle: "Income & Expenditure" },
  ngo:        { label: "NGO / Trust", income: "Donations",        incomeGroup: "Indirect Incomes",  capital: "Corpus Fund",  plTitle: "Income & Expenditure" },
  personal:   { label: "Personal",   income: "Income",            incomeGroup: "Indirect Incomes",  capital: "Capital A/c",  plTitle: "Income & Expenses" },
};

/* ===== Helpers ===== */
const todayISO = () => new Date().toISOString().slice(0, 10);
const FY_START = "2025-04-01";
const fmt = (n) => "₹" + Math.abs(Math.round(n)).toLocaleString("en-IN");
const pad = (n) => String(n).padStart(2, "0");
const titleCase = (s) => s.trim().split(/\s+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");

/* ===== Nature analysis: asset vs expense vs stock ===== */
const ASSET_WORDS = ["laptop","computer","desktop","printer","furniture","table","chair","machine","machinery","equipment","vehicle","car","bike","scooter","land","building","property","air conditioner","camera","generator","tools","fixture","server"];
const EXPENSE_WORDS = ["rent","salary","salaries","wages","electricity","fuel","petrol","diesel","food","tea","snacks","stationery","internet","recharge","bill","repair","maintenance","commission","interest","charges","courier","postage","printing","travel","conveyance","cleaning"];
const STOCK_WORDS = ["goods","stock","raw material","raw materials","inventory","materials","merchandise"];
function classifyHead(text, fallback) {
  const t = text.toLowerCase();
  if (STOCK_WORDS.some(w => t.includes(w))) return { head: "Purchases", group: "Purchase Accounts", nature: "Stock / Purchase" };
  const bill = EXPENSE_WORDS.find(w => t.includes(w));
  if (!bill && ASSET_WORDS.some(w => t.includes(w))) {
    const found = ASSET_WORDS.find(w => t.includes(w));
    return { head: titleCase(found), group: "Fixed Assets", nature: "Fixed Asset" };
  }
  if (bill && (!fallback || fallback === "Expenses")) return { head: titleCase(bill), group: "Indirect Expenses", nature: "Expense" };
  return { head: fallback || "Expenses", group: "Indirect Expenses", nature: "Expense" };
}


/* ===== Logic engine: completeness validation & clarification (per approved spec) ===== */
function lev(a, b) { a = a.toLowerCase(); b = b.toLowerCase(); const m = a.length, n = b.length; if (!m) return n; if (!n) return m; const d = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]); for (let j = 1; j <= n; j++) d[0][j] = j; for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[m][n]; }
function similarity(a, b) { const L = Math.max(a.length, b.length); return L ? 1 - lev(a, b) / L : 1; }
const fmtIN = (n) => Number(n || 0).toLocaleString("en-IN");

function postProcess(d, ledgers) {
  const banks = ledgers.filter(l => l.group === "Bank Accounts");
  // resolve generic "Bank A/c" against the user's actual banks
  d.entries = d.entries.map(e => {
    if (e.group === "Bank Accounts" && e.ledger === "Bank A/c") {
      if (banks.length === 1) return { ...e, ledger: banks[0].name };
      d.bankAmbiguous = banks.length > 1;
    }
    return e;
  });
  // receipt from an existing debtor => credit the debtor, not income
  if (d.type === "Receipt" && d.party) {
    const debtor = ledgers.find(l => l.group === "Sundry Debtors" && similarity(l.name, d.party) >= 0.85);
    if (debtor) {
      d.entries = d.entries.map(e => e.side === "cr" ? { ...e, ledger: debtor.name, group: "Sundry Debtors" } : e);
      d.party = debtor.name; d.natureLabel = "Collection from debtor";
    }
  }
  return d;
}

function validateDraft(d, ledgers) {
  const issues = [];
  const banks = ledgers.filter(l => l.group === "Bank Accounts");
  if (!d.amount || d.amount <= 0) issues.push({ id: "amount", q: "How much was it?", type: "amount" });
  else if (d.amount > 10000000 && !d.absurdOk) issues.push({ id: "absurd", q: `I heard \u20B9${fmtIN(d.amount)} \u2014 is that right?`, type: "chips", chips: ["Yes, correct", "Let me edit"] });
  if (d.noVerb) issues.push({ id: "verb", q: `Did you pay ${d.party || "them"} or receive from them?`, type: "chips", chips: ["Paid", "Received"] });
  if (d.type === "Payment" && d.headMissing) issues.push({ id: "head", q: `What was this \u20B9${fmtIN(d.amount)} to ${d.party} for?`, type: "chips", chips: ["General expense", "Against their bill (creditor)", "Loan given"], free: true });
  if (d.type === "Receipt" && d.srcMissing) issues.push({ id: "source", q: `Received \u20B9${fmtIN(d.amount)} \u2014 from whom, and for what?`, type: "free" });
  if (d.bankAmbiguous && banks.length > 1) issues.push({ id: "bank", q: "Which bank?", type: "chips", chips: banks.map(b => b.name) });
  if (d.natureLabel === "Fixed Asset" && d.amount > 0 && d.amount < 5000 && !d.smallAssetAsked) issues.push({ id: "smallasset", q: `Book ${d.entries[0].ledger} \u20B9${fmtIN(d.amount)} as an asset or an expense?`, type: "chips", chips: ["Asset", "Expense"] });
  if (d.party && !d.fuzzyResolved) {
    const exact = ledgers.find(l => l.name.toLowerCase() === d.party.toLowerCase());
    if (!exact) {
      const near = ledgers.map(l => ({ l, s: similarity(l.name, d.party) })).filter(x => x.s >= 0.85 && x.s < 1).sort((a, b) => b.s - a.s)[0];
      if (near) issues.push({ id: "fuzzy", q: `Same as \u201C${near.l.name}\u201D?`, type: "chips", chips: [`Yes \u2014 ${near.l.name}`, "No, new ledger"], ref: near.l.name });
    }
  }
  return issues;
}

function applyAnswer(draft, issue, answer, cfg) {
  const d = JSON.parse(JSON.stringify(draft));
  const setAmt = (a) => { d.amount = a; d.entries = d.entries.map(e => ({ ...e, amount: a })); };
  if (issue.id === "amount") setAmt(parseInt(String(answer).replace(/\D/g, "") || "0", 10));
  if (issue.id === "absurd") { d.absurdOk = true; if (answer === "Let me edit") d.forceReview = true; }
  if (issue.id === "verb") {
    d.noVerb = false;
    if (answer === "Received") {
      d.type = "Receipt";
      d.entries = [{ ledger: "Cash", side: "dr", amount: d.amount, group: "Cash-in-Hand" }, { ledger: d.party || cfg.income, side: "cr", amount: d.amount, group: cfg.incomeGroup }];
      d.natureLabel = "Receipt / Income"; d.modeAssumed = true;
    } else { d.type = "Payment"; }
  }
  if (issue.id === "head") {
    d.headMissing = false;
    if (answer.startsWith("Against")) { d.entries[0] = { ledger: d.party, side: "dr", amount: d.amount, group: "Sundry Creditors" }; d.natureLabel = "Creditor payment"; }
    else if (answer === "Loan given") { d.entries[0] = { ledger: d.party + " (Loan)", side: "dr", amount: d.amount, group: "Loans & Advances (Asset)" }; d.natureLabel = "Loan / advance"; }
    else if (answer === "General expense") { d.entries[0] = { ledger: "General Expenses", side: "dr", amount: d.amount, group: "Indirect Expenses" }; d.natureLabel = "Expense"; }
    else { const cls = classifyHead(String(answer).toLowerCase(), titleCase(String(answer))); d.entries[0] = { ledger: cls.head, side: "dr", amount: d.amount, group: cls.group }; d.natureLabel = cls.nature; d.narration += " \u2014 " + answer; }
  }
  if (issue.id === "source") {
    const p = parseSpeech("received " + d.amount + " from " + answer, cfg);
    d.entries = p.entries; d.party = p.party; d.srcMissing = false; d.narration += " \u2014 " + answer;
  }
  if (issue.id === "bank") { d.entries = d.entries.map(e => e.group === "Bank Accounts" ? { ...e, ledger: answer } : e); d.bankAmbiguous = false; }
  if (issue.id === "smallasset") { d.smallAssetAsked = true; if (answer === "Expense") { d.entries[0] = { ...d.entries[0], group: "Indirect Expenses" }; d.natureLabel = "Expense"; } }
  if (issue.id === "fuzzy") { d.fuzzyResolved = true; if (answer.startsWith("Yes")) { const old = d.party; d.party = issue.ref; d.entries = d.entries.map(e => similarity(e.ledger, old) >= 0.85 ? { ...e, ledger: issue.ref } : e); } }
  return d;
}

/* ===== Compliance alerts engine (per approved catalogue) ===== */
function fyStartOf(dateISO) { const [y, m] = dateISO.split("-").map(Number); return (m >= 4 ? y : y - 1) + "-04-01"; }
function partyFYTotal(vouchers, party, dateISO, headRe) {
  if (!party) return 0; const fs = fyStartOf(dateISO);
  return vouchers.filter(v => v.date >= fs && v.date <= dateISO && (v.party || "").toLowerCase() === party.toLowerCase() && (!headRe || headRe.test((v.narration || "") + " " + v.entries.map(e => e.ledger).join(" ")))).reduce((s, v) => s + (v.entries[0]?.amount || 0), 0);
}
function computeAlerts(d, dateISO, ctx) {
  const A = []; const push = (sev, code, text, ref) => A.push({ sev, code, text, ref });
  const t = ((d.narration || "") + " " + d.entries.map(e => e.ledger).join(" ")).toLowerCase();
  const amt = d.amount || 0;
  const isCash = d.entries.some(e => e.group === "Cash-in-Hand");
  const isPay = ["Payment", "Purchase"].includes(d.type);
  const isRcpt = ["Receipt", "Sales"].includes(d.type);
  const biz = ["business", "profession"].includes(ctx.settings.accountType);
  const drGroup = d.entries[0]?.group;
  const transporter = /transport|freight|lorry|truck/.test(t);
  const loanWord = /loan|deposit|advance for property/.test(t);
  const fyTot = (re) => partyFYTotal(ctx.vouchers, d.party, dateISO, re) + amt;

  // Income tax
  if (isPay && isCash && biz && drGroup === "Indirect Expenses" && !transporter && amt > 10000)
    push("red", "IT-01", "Cash expense over \u20B910,000/day to one person is fully disallowable \u2014 pay by bank/UPI to claim deduction.", "u/s 36 ITA 2025 [old 40A(3)]");
  if (isPay && isCash && transporter && amt > 35000)
    push("red", "IT-02", "Cash limit for transporters is \u20B935,000/day \u2014 above this the expense is disallowable.", "u/s 36 ITA 2025 [old 40A(3)]");
  if (isRcpt && isCash && amt >= 200000)
    push("red", "IT-03", "Cash receipt of \u20B92 lakh+ (per day/transaction/event) attracts 100% penalty.", "u/s 186 ITA 2025 [old 269ST]");
  if (d.type === "Receipt" && isCash && loanWord && amt >= 20000)
    push("red", "IT-04", "Loans/deposits of \u20B920,000+ must not be accepted in cash \u2014 penalty equals the amount.", "u/s 185 ITA 2025 [old 269SS]");
  if (isPay && isCash && /loan repay|repaid|repayment/.test(t) && amt >= 20000)
    push("red", "IT-05", "Repaying a loan/deposit of \u20B920,000+ in cash attracts 100% penalty \u2014 repay through bank.", "u/s 188 ITA 2025 [old 269T]");
  if (isPay && isCash && drGroup === "Fixed Assets" && amt > 10000)
    push("red", "IT-06", "Asset paid in cash above \u20B910,000: that payment is excluded from cost \u2014 no depreciation on it.", "[old 43(1) proviso]");
  else if (drGroup === "Fixed Assets")
    push("info", "IT-07", "Capital expenditure \u2014 claim depreciation, not expense; used <180 days this year gets half-rate.", "u/s 33 ITA 2025 [old 32]");
  if (isPay && /gst payable|pf |esi|provident|professional tax|bonus|leave encashment/.test(t))
    push("amb", "IT-08", "Statutory dues are deductible only if actually paid by the ITR due date.", "u/s 37 ITA 2025 [old 43B]");
  if (isPay && d.entries.some(e => e.side === "cr" && e.group === "Sundry Creditors"))
    push("amb", "IT-09", "If the supplier is MSME-registered, pay within 45 days (15 if no agreement) or deduction shifts to year of payment.", "u/s 37 ITA 2025 [old 43B(h)]");
  if (isPay && isCash && /donation/.test(t) && amt > 2000)
    push("amb", "IT-11", "Cash donations above \u20B92,000 get no income-tax deduction \u2014 pay digitally to claim it.", "[old 80G(5D)]");

  // TDS (Section 393 master table; thresholds w.e.f. Apr 2025)
  if (biz && isPay && d.party) {
    if (/contract|job work|labour|labor/.test(t) && (amt > 30000 || fyTot(/contract|job work|labour|labor/) > 100000))
      push("amb", "TD-01", "Contractor payment \u2014 deduct TDS @1% (individual/HUF) or 2% (others) before paying.", "S.393 [old 194C]");
    if (/professional|consult|audit/.test(t) && fyTot(/professional|consult|audit/) > 50000)
      push("amb", "TD-02", "Professional fees crossing \u20B950,000/yr \u2014 deduct TDS @10%.", "S.393 [old 194J]");
    if (/commission|brokerage/.test(t) && fyTot(/commission|brokerage/) > 20000)
      push("amb", "TD-03", "Commission above \u20B920,000/yr \u2014 deduct TDS @2%.", "S.393 [old 194H]");
    if (/rent/.test(t) && fyTot(/rent/) > 600000)
      push("amb", "TD-04", "Rent above \u20B96,00,000/yr (\u20B950,000/month) \u2014 deduct TDS @10% (building) / 2% (plant).", "S.393 [old 194-I]");
    if (/interest/.test(t) && !/bank/.test(t) && fyTot(/interest/) > 10000)
      push("amb", "TD-05", "Interest paid above \u20B910,000/yr \u2014 deduct TDS @10%.", "S.393 [old 194A]");
  }

  // GST
  const reg = ctx.settings.gstRegistered;
  if (reg && isPay && /rent/.test(t) && !/residential|house|flat|home/.test(t))
    push("amb", "GS-02", "Commercial rent from an unregistered landlord attracts GST @18% under reverse charge (claim ITC).", "Notif. 09/2024-CT(R)");
  if (reg && isPay && /rent/.test(t) && /residential|house|flat|home/.test(t))
    push("amb", "GS-03", "Residential rent paid by a registered person attracts GST under reverse charge.", "Notif. 05/2022-CT(R)");
  if (reg && isPay && /freight|transport|lorry|gta/.test(t))
    push("amb", "GS-04", "Freight to a GTA may attract 5% GST under reverse charge \u2014 check consignment note.", "CGST S.9(3)");
  if (reg && isPay && /advocate|legal fee/.test(t))
    push("amb", "GS-05", "Advocate fees attract GST under reverse charge \u2014 pay in cash ledger, claim ITC.", "CGST S.9(3)");
  if (reg && isPay && d.entries.some(e => e.side === "cr" && e.group === "Sundry Creditors"))
    push("info", "GS-06", "Pay this supplier within 180 days of invoice, else ITC must be reversed with interest.", "S.16(2) \u00B7 Rule 37");
  if (reg && isPay && /food|beverage|restaurant|catering|club/.test(t))
    push("red", "GS-07", "ITC is blocked on this expense \u2014 don\u2019t claim GST credit on it.", "CGST S.17(5)");
  if ((d.type === "Sales" || d.type === "Purchase") && /goods|stock|material/.test(t) && amt > 50000)
    push("amb", "GS-09", "Goods movement above \u20B950,000 needs an e-Way Bill before transport.", "Rule 138");
  if (ctx.settings.composition && d.type === "Sales")
    push("red", "GS-10", "Composition dealer: issue a Bill of Supply and do NOT collect GST from the customer.", "CGST S.10 \u00B7 S.31(3)(c)");

  // Professional tax (Karnataka) & misc
  if (isPay && /salary|wages/.test(t) && amt > 25000)
    push("amb", "PT-01", "Deduct Karnataka PT \u20B9200/month from salaries above \u20B925,000; remit by the 20th.", "KTPTC&E Act 1976");
  if (/drawings/.test(t))
    push("info", "OT-06", "Drawings reduce capital \u2014 neither a business expense nor taxable.", "");

  const order = { red: 0, amb: 1, info: 2 };
  return A.sort((a, b) => order[a.sev] - order[b.sev]);
}

/* ===== Voice parser ===== */
const BANK_HINTS = ["bank","sbi","hdfc","icici","axis","kotak","upi","account","a/c"];
function parseAmount(t) {
  const m = t.replace(/,/g, "").match(/(\d+(\.\d+)?)\s*(k|thousand|hazaar|hajar|hazar|lakh|lac|laakh|hundred|sau|crore|karod)?/i);
  if (!m) return null;
  let n = parseFloat(m[1]); const u = (m[3] || "").toLowerCase();
  if (["k","thousand","hazaar","hajar","hazar"].includes(u)) n *= 1000;
  else if (["lakh","lac","laakh"].includes(u)) n *= 100000;
  else if (["hundred","sau"].includes(u)) n *= 100;
  else if (["crore","karod"].includes(u)) n *= 10000000;
  return Math.round(n);
}
/* Hinglish / Kannada-English normalizer: rewrites common Indian phrasing into the parser's English patterns */
function hinglishNormalize(t) {
  let x = " " + t + " ";
  const koPay = x.match(/ ([a-z][a-z ]*?) ko (?:rs\.? |rupees )?([\d,]+\s*(?:k|hazaar|hajar|lakh|lac|sau|hundred|thousand)?) ?(?:ka |ki |ke )?[a-z ]*?(diye|diya|de diya|de di|bheja|bheji|bhej diya|payment kiya|pay kiya|chukaya)/);
  if (koPay) x = " paid " + koPay[2] + " to " + koPay[1].trim() + " " + x;
  const seRecv = x.match(/ ([a-z][a-z ]*?) se (?:rs\.? |rupees )?([\d,]+\s*(?:k|hazaar|hajar|lakh|lac|sau|hundred|thousand)?) ?[a-z ]*?(mile|mila|mili|aaya|aayi|aaye|wasool)/);
  if (seRecv) x = " received " + seRecv[2] + " from " + seRecv[1].trim() + " " + x;
  x = x.replace(/ (diye|diya|de diya|de di|bheja|bheji|chukaya|bhugtan kiya|pay kiya|payment kiya|kharcha kiya|kharch kiya|kodalaagide|kotte) /g, " paid ")
       .replace(/ (mile|mila|mili|aaya|aayi|prapt hua|wasool kiya|bandide|sikkide) /g, " received ")
       .replace(/ (becha|bech diya|bikri|maaride|maaridini) /g, " sold ")
       .replace(/ (kharida|kharide|khareeda|le liya|kondukonde) /g, " bought ")
       .replace(/ (jama kiya|jama kar diya|deposit kiya) /g, " deposited ")
       .replace(/ (nikala|nikale|withdraw kiya) /g, " withdrew ")
       .replace(/ (udhaar|udhar|baaki|baki)( par| pe| me| mein)? /g, " on credit ")
       .replace(/ (nakad|rokda|naqad|cash me|cash mein|nagadu) /g, " cash ")
       .replace(/ (kiraya|kiraaya|baadige) /g, " rent ")
       .replace(/ (tankha|pagar|tankhwah|sambala) /g, " salary ")
       .replace(/ (bijli|vidyut) /g, " electricity ")
       .replace(/ (maal|samaan|saman|sarku) /g, " goods ")
       .replace(/ (majdoori|mazdoori|kooli) /g, " labour ")
       .replace(/ (chanda|daan) /g, " donation ");
  return x.trim();
}

function parseSpeech(raw, cfg) {
  const t = hinglishNormalize((raw || "").toLowerCase());
  const amount = parseAmount(t) || 0;
  const usesBank = BANK_HINTS.some(h => t.includes(h));
  const namedBank = /sbi|hdfc|icici|axis|kotak/.test(t);
  const bankName = /sbi/.test(t) ? "SBI Bank A/c" : (usesBank ? "Bank A/c" : null);
  const cashOrBank = usesBank ? (bankName || "Bank A/c") : "Cash";
  const cbGroup = usesBank ? "Bank Accounts" : "Cash-in-Hand";
  const onCredit = /(on credit|udhaar|udhar|baaki|baki|credit se)/.test(t);
  const saysCash = /cash/.test(t);
  const fromM = t.match(/from ([a-z0-9& ]+?)(?: for | as |,|$)/);
  const toM = t.match(/to ([a-z0-9& ]+?)(?: for | as |,|$)/);
  const forM = t.match(/(?:for|as) ([a-z0-9& ]+)$/);
  const hasVerb = /(paid|pay |spent|bought|purchase|gave|received|got |receipt|donation|grant|sold|sales|sale |deposit|withdraw|withdrew|adjust)/.test(t);
  let type = "Payment", entries = [], party = "", narration = raw.trim(), natureLabel = "";
  let headMissing = false, srcMissing = false;

  if (/(received|got |receipt|donation|grant)/.test(t)) {
    type = "Receipt"; party = fromM ? titleCase(fromM[1]) : "";
    const hasHeadWord = /consult|fee|service|donation|grant|rent|interest|commission/.test(t);
    const head = /consult|fee|service/.test(t) ? cfg.income : (/(donation|grant)/.test(t) ? "Donations" : (party || cfg.income));
    if (!party && !hasHeadWord) srcMissing = true;
    entries = [{ ledger: cashOrBank, side: "dr", amount, group: cbGroup }, { ledger: head, side: "cr", amount, group: cfg.incomeGroup }];
    natureLabel = "Receipt / Income";
  } else if (/(cash sale|sales|sold|sale )/.test(t)) {
    type = "Sales"; party = toM ? titleCase(toM[1]) : "";
    const drL = (onCredit && party) ? { ledger: party, side: "dr", amount, group: "Sundry Debtors" } : { ledger: cashOrBank, side: "dr", amount, group: cbGroup };
    entries = [drL, { ledger: "Sales", side: "cr", amount, group: "Sales Accounts" }];
    natureLabel = onCredit ? "Credit sale" : "Sales";
  } else if (/(deposit|withdraw|withdrew)/.test(t)) {
    type = "Contra";
    entries = /deposit/.test(t)
      ? [{ ledger: bankName || "Bank A/c", side: "dr", amount, group: "Bank Accounts" }, { ledger: "Cash", side: "cr", amount, group: "Cash-in-Hand" }]
      : [{ ledger: "Cash", side: "dr", amount, group: "Cash-in-Hand" }, { ledger: bankName || "Bank A/c", side: "cr", amount, group: "Bank Accounts" }];
    natureLabel = "Contra (cash to/from bank)";
  } else {
    type = "Payment"; party = toM ? titleCase(toM[1]) : "";
    const stockWords = STOCK_WORDS.some(w => t.includes(w));
    const cls = classifyHead(t, forM ? titleCase(forM[1]) : (party || "Expenses"));
    if (party && !forM && cls.nature === "Expense" && !EXPENSE_WORDS.some(w => t.includes(w)) && !stockWords) headMissing = true;
    const crL = (onCredit && party) ? { ledger: party, side: "cr", amount, group: "Sundry Creditors" } : { ledger: cashOrBank, side: "cr", amount, group: cbGroup };
    entries = [{ ledger: cls.head, side: "dr", amount, group: cls.group }, crL];
    natureLabel = (stockWords && onCredit) ? "Credit purchase" : cls.nature;
    if (stockWords) type = "Purchase";
  }
  return { type, entries, party, narration, amount, natureLabel,
    noVerb: !hasVerb && amount > 0, headMissing, srcMissing,
    genericBank: usesBank && !namedBank, usesBank,
    modeAssumed: !usesBank && !saysCash && !onCredit && (type === "Payment" || type === "Receipt") };
}

/* ===== Document scan (vision) → voucher ===== */
async function scanDocument(dataUrl, mediaType, cfg, apiKey) {
  const base64 = dataUrl.split(",")[1];
  const prompt = `You are an accounting assistant for India. This image is a financial document — an invoice, receipt, payment voucher, cheque, or other document. Extract its details and reply with ONLY a JSON object (no prose, no markdown fences). Schema:
{"docType":"invoice|receipt|voucher|cheque|document|unknown","direction":"payment|receipt|purchase|sales|unknown","amount":<number: grand total in rupees, plain digits>,"party":"<vendor/payee/drawer name>","date":"YYYY-MM-DD","gst":<number or 0>,"gstin":"<string or empty>","description":"<short: what it is for>","paymentMode":"cash|bank|upi|cheque|credit|unknown","chequeNo":"<string or empty>","bank":"<bank name or empty>"}
Rules: amount = grand total, no commas or ₹. A supplier's tax invoice billed TO the reader => direction "purchase". A cheque => docType "cheque", paymentMode "cheque". Give date as YYYY-MM-DD. If unreadable, docType "unknown" and amount 0.`;
  const headers = { "Content-Type": "application/json" };
  if (apiKey) { headers["x-api-key"] = apiKey; headers["anthropic-version"] = "2023-06-01"; headers["anthropic-dangerous-direct-browser-access"] = "true"; }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers,
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 1000, messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } }, { type: "text", text: prompt }] }] }),
  });
  const json = await res.json();
  const text = (json.content || []).filter(b => b.type === "text").map(b => b.text).join("").trim();
  const data = JSON.parse(text.replace(/```json|```/g, "").trim());
  return docToDraft(data, cfg, dataUrl);
}
function docToDraft(data, cfg, image) {
  const amount = Math.round(Number(data.amount) || 0);
  const party = (data.party || "").trim();
  const mode = (data.paymentMode || "unknown").toLowerCase();
  const dir = (data.direction || "").toLowerCase();
  const docType = (data.docType || "document").toLowerCase();
  const docLabel = docType.charAt(0).toUpperCase() + docType.slice(1);
  const desc = (data.description || "").trim();
  const cbLedger = mode === "cash" ? "Cash" : (data.bank && mode !== "upi" ? data.bank : "Bank A/c");
  const cbGroup = mode === "cash" ? "Cash-in-Hand" : "Bank Accounts";
  let type = "Payment", entries = [], natureLabel = "";
  const isIncome = dir === "receipt" || dir === "sales";
  if (docType === "cheque" || mode === "cheque") {
    const cls = classifyHead(desc || party, party || "Expenses");
    entries = [{ ledger: cls.head, side: "dr", amount, group: cls.group }, { ledger: data.bank || "Bank A/c", side: "cr", amount, group: "Bank Accounts" }];
    natureLabel = "Cheque payment";
  } else if (isIncome) {
    type = (docType === "invoice" && dir === "sales") ? "Sales" : "Receipt";
    const inLedger = dir === "sales" ? "Sales" : (party || cfg.income);
    const inGroup = dir === "sales" ? "Sales Accounts" : cfg.incomeGroup;
    const drLedger = mode === "credit" ? (party || "Sundry Debtors") : cbLedger;
    const drGroup = mode === "credit" ? "Sundry Debtors" : cbGroup;
    entries = [{ ledger: drLedger, side: "dr", amount, group: drGroup }, { ledger: inLedger, side: "cr", amount, group: inGroup }];
    natureLabel = dir === "sales" ? "Sales" : "Receipt / Income";
  } else {
    const cls = classifyHead(desc || party, party || "Expenses");
    const crLedger = mode === "credit" ? (party || "Sundry Creditors") : cbLedger;
    const crGroup = mode === "credit" ? "Sundry Creditors" : cbGroup;
    entries = [{ ledger: cls.head, side: "dr", amount, group: cls.group }, { ledger: crLedger, side: "cr", amount, group: crGroup }];
    natureLabel = cls.nature;
  }
  const narration = [docLabel, party].filter(Boolean).join(" — ") + (desc ? `: ${desc}` : "") + (data.chequeNo ? ` (Cheque ${data.chequeNo})` : "") + (data.gst ? ` incl. GST ₹${Math.round(data.gst)}` : "");
  const date = data.date && /^\d{4}-\d{2}-\d{2}$/.test(data.date) ? data.date : null;
  return { type, entries, party, narration, amount, natureLabel, source: "photo", image, docLabel, date };
}

/* ===== Seed data ===== */
const seedLedgers = [
  { name: "Capital A/c", group: "Capital Account", opening: -55000 },
  { name: "SBI Bank A/c", group: "Bank Accounts", opening: 40000 },
  { name: "Cash", group: "Cash-in-Hand", opening: 15000 },
  { name: "Sales", group: "Sales Accounts", opening: 0 },
  { name: "Consulting Income", group: "Indirect Incomes", opening: 0 },
  { name: "Office Expenses", group: "Indirect Expenses", opening: 0 },
  { name: "Travelling Exp", group: "Indirect Expenses", opening: 0 },
  { name: "Computer", group: "Fixed Assets", opening: 0 },
];
const mkV = (id, date, type, narration, dr, cr, amount) => ({ id, date, type, narration, entries: [{ ledger: dr, side: "dr", amount }, { ledger: cr, side: "cr", amount }] });
const seedVouchers = [
  mkV("s1", "2025-06-10", "Receipt", "Consulting fees — Janani Society", "SBI Bank A/c", "Consulting Income", 12000),
  mkV("s2", "2025-06-12", "Sales", "Cash sales", "Cash", "Sales", 5000),
  mkV("s3", "2025-06-12", "Payment", "Office supplies — Sharma Stationers", "Office Expenses", "Cash", 1200),
  mkV("s4", "2025-06-15", "Payment", "Fuel — site visit", "Travelling Exp", "Cash", 2000),
  mkV("s5", "2025-06-18", "Payment", "Bought computer", "Computer", "SBI Bank A/c", 30000),
];

/* ===== Balance engine ===== */
function computeBalances(ledgers, vouchers) {
  const bal = {}; ledgers.forEach(l => { bal[l.name] = l.opening || 0; });
  vouchers.forEach(vc => vc.entries.forEach(e => { if (!(e.ledger in bal)) bal[e.ledger] = 0; bal[e.ledger] += e.side === "dr" ? e.amount : -e.amount; }));
  return bal;
}

function balancesAsOn(ledgers, vouchers, asOn) {
  const bal = {}; ledgers.forEach(l => { bal[l.name] = l.opening || 0; });
  vouchers.filter(v => v.date <= asOn).forEach(vc => vc.entries.forEach(e => { if (!(e.ledger in bal)) bal[e.ledger] = 0; bal[e.ledger] += e.side === "dr" ? e.amount : -e.amount; }));
  return bal;
}
function flowsBetween(vouchers, from, to) {
  const f = {};
  vouchers.filter(v => v.date >= from && v.date <= to).forEach(vc => vc.entries.forEach(e => { f[e.ledger] = (f[e.ledger] || 0) + (e.side === "dr" ? e.amount : -e.amount); }));
  return f;
}
/* GST split: rebuilds a 2-line Sales/Purchase voucher into base + CGST/SGST (or IGST) lines */
function gstSplitEntries(d, rate, igst) {
  const orig = d.origEntries || d.entries.filter(e => !/^(Output|Input) (CGST|SGST|IGST)$/.test(e.ledger));
  const money = orig.find(e => ["Cash-in-Hand", "Bank Accounts", "Sundry Debtors", "Sundry Creditors"].includes(e.group)) || orig[d.type === "Sales" ? 0 : 1];
  const baseLine = orig.find(e => e !== money) || orig[d.type === "Sales" ? 1 : 0];
  const total = d.amount;
  if (!rate) return { entries: [ { ...money, amount: total }, { ...baseLine, amount: total } ].sort((a,b)=>a.side==="dr"?-1:1), origEntries: orig, gstRate: 0, gstIgst: !!igst };
  const base = Math.round(total * 100 / (100 + rate));
  const tax = total - base; const half = Math.floor(tax / 2);
  const pre = d.type === "Sales" ? "Output" : "Input";
  const taxSide = d.type === "Sales" ? "cr" : "dr";
  const taxLines = igst
    ? [{ ledger: pre + " IGST", side: taxSide, amount: tax, group: "Duties & Taxes" }]
    : [{ ledger: pre + " CGST", side: taxSide, amount: half, group: "Duties & Taxes" }, { ledger: pre + " SGST", side: taxSide, amount: tax - half, group: "Duties & Taxes" }];
  const entries = d.type === "Sales"
    ? [ { ...money, side: "dr", amount: total }, { ...baseLine, side: "cr", amount: base }, ...taxLines ]
    : [ { ...baseLine, side: "dr", amount: base }, ...taxLines, { ...money, side: "cr", amount: total } ];
  return { entries, origEntries: orig, gstRate: rate, gstIgst: !!igst };
}

/* ===== Tally XML ===== */
const esc = (s) => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
const tallyDate = (iso) => { const [y,m,d]=iso.split("-"); return `${y}${m}${d}`; };
function buildTallyXML({ ledgers, vouchers, scope, from, to, company = "Karkoon" }) {
  const inRange = vouchers.filter(v => v.date >= from && v.date <= to);
  const used = new Set(); inRange.forEach(v => v.entries.forEach(e => used.add(e.ledger)));
  const masters = ledgers.filter(l => scope === "masters" ? true : used.has(l.name) || scope === "both");
  let msgs = "";
  if (scope === "masters" || scope === "both") masters.forEach(l => {
    msgs += `\n   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n    <LEDGER NAME="${esc(l.name)}" ACTION="Create">\n     <PARENT>${esc(l.group)}</PARENT>\n     <OPENINGBALANCE>${(-(l.opening||0)).toFixed(2)}</OPENINGBALANCE>\n    </LEDGER>\n   </TALLYMESSAGE>`;
  });
  let vno = 0;
  if (scope === "vouchers" || scope === "both") inRange.forEach(v => { vno += 1;
    let le = ""; v.entries.forEach(e => {
      le += `\n     <ALLLEDGERENTRIES.LIST>\n      <LEDGERNAME>${esc(e.ledger)}</LEDGERNAME>\n      <ISDEEMEDPOSITIVE>${e.side==="dr"?"Yes":"No"}</ISDEEMEDPOSITIVE>\n      <AMOUNT>${(e.side==="dr"?-e.amount:e.amount).toFixed(2)}</AMOUNT>\n     </ALLLEDGERENTRIES.LIST>`;
    });
    msgs += `\n   <TALLYMESSAGE xmlns:UDF="TallyUDF">\n    <VOUCHER VCHTYPE="${esc(v.type)}" ACTION="Create">\n     <DATE>${tallyDate(v.date)}</DATE>\n     <VOUCHERTYPENAME>${esc(v.type)}</VOUCHERTYPENAME>\n     <VOUCHERNUMBER>KK-${String(vno).padStart(4,"0")}</VOUCHERNUMBER>\n     <NARRATION>${esc(v.narration||"")}</NARRATION>${le}\n    </VOUCHER>\n   </TALLYMESSAGE>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE>\n <HEADER>\n  <TALLYREQUEST>Import Data</TALLYREQUEST>\n </HEADER>\n <BODY>\n  <IMPORTDATA>\n   <REQUESTDESC>\n    <REPORTNAME>${scope==="vouchers"?"Vouchers":"All Masters"}</REPORTNAME>\n   </REQUESTDESC>\n   <REQUESTDATA>${msgs}\n   </REQUESTDATA>\n  </IMPORTDATA>\n </BODY>\n</ENVELOPE>`;
}

/* ===== Persistence ===== */
const STORE_KEY = "karkoon:v1";
const OLD_STORE_KEY = "tellridhay:v1";
async function loadState(){
  try{ if(typeof window!=="undefined"&&window.storage){const r=await window.storage.get(STORE_KEY); if(r&&r.value)return JSON.parse(r.value);} }catch(e){}
  try{ const s=localStorage.getItem(STORE_KEY); if(s) return JSON.parse(s); }catch(e){}
  try{ const s=localStorage.getItem(OLD_STORE_KEY); if(s) return JSON.parse(s); }catch(e){}
  return null;
}
async function saveState(s){
  try{ if(typeof window!=="undefined"&&window.storage){ await window.storage.set(STORE_KEY, JSON.stringify(s)); return; } }catch(e){}
  try{ localStorage.setItem(STORE_KEY, JSON.stringify(s)); }catch(e){}
}

/* ===== Logo ===== */
function Logo({ size = 28, variant = "light" }) {
  const k = variant === "dark" ? "#B23A57" : BURGUNDY;      // K strokes
  const edge = variant === "dark" ? "#6E1430" : BURGUNDY_DK; // outline under tick
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none">
      {/* italic K stem */}
      <path d="M29 6 L19 40" stroke={k} strokeWidth="10" strokeLinecap="round" />
      {/* lower-right leg */}
      <path d="M23.5 25 C29 29 33 34 35 41" stroke={k} strokeWidth="9" strokeLinecap="round" />
      {/* gold tick (K arm) with thin outline */}
      <path d="M7 30 L14 40 L42 8" stroke={edge} strokeWidth="10.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M7 30 L14 40 L42 8" stroke={GOLD} strokeWidth="7.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
function Wordmark({ variant = "light", size = 18 }) {
  const c = variant === "dark" ? GOLD : BURGUNDY;
  return (<span style={{ fontSize: size, color: c }} className="font-bold tracking-tight">Kar<span style={{ color: variant === "dark" ? GOLD_BRIGHT : BURGUNDY }}>koon</span></span>);
}

function Money({ n, kind }) {
  const c = kind === "e" ? EXP : kind === "i" ? INC : INK;
  return <span style={{ color: c }} className="font-mono font-semibold tabular-nums">{fmt(n)}</span>;
}

/* ================================================================= */
export default function App() {
  const [ready, setReady] = useState(false);
  const [view, setView] = useState("auth");
  const [tab, setTab] = useState("speak");
  const [report, setReport] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const [user, setUser] = useState(null);
  const [companies, setCompanies] = useState([{ id: "c1", name: "My Business", ledgers: seedLedgers, vouchers: seedVouchers, audit: [] }]);
  const [activeCo, setActiveCo] = useState("c1");
  const [locked, setLocked] = useState(false);
  const co = companies.find(c => c.id === activeCo) || companies[0];
  const ledgers = co.ledgers, vouchers = co.vouchers;
  const setCo = (fn) => setCompanies(prev => prev.map(c => c.id === co.id ? fn(c) : c));
  const setLedgers = (fn) => setCo(c => ({ ...c, ledgers: typeof fn === "function" ? fn(c.ledgers) : fn }));
  const setVouchers = (fn) => setCo(c => ({ ...c, vouchers: typeof fn === "function" ? fn(c.vouchers) : fn }));
  const pushAudit = (entry) => setCo(c => ({ ...c, audit: [{ at: new Date().toISOString(), ...entry }, ...(c.audit || [])] }));
  const [settings, setSettings] = useState({ accountType: "business", mode: "complete", wakeOnLock: false, lang: "en-IN", gstRegistered: false, composition: false });

  useEffect(() => { (async () => {
    const s = await loadState();
    if (s) {
      setUser(s.user||null);
      if (s.companies && s.companies.length) { setCompanies(s.companies); setActiveCo(s.activeCo || s.companies[0].id); }
      else if (s.ledgers || s.vouchers) setCompanies([{ id: "c1", name: "My Business", ledgers: s.ledgers||seedLedgers, vouchers: s.vouchers||seedVouchers, audit: [] }]);
      if (s.settings) setSettings(prev => ({ ...prev, ...s.settings }));
      if (s.user) { setView("app"); if (s.settings && s.settings.pin) setLocked(true); }
    }
    setReady(true);
  })(); }, []);
  useEffect(() => { if (ready) saveState({ user, companies, activeCo, settings }); }, [user, companies, activeCo, settings, ready]);

  const cfg = TYPE_CFG[settings.accountType];
  const balances = useMemo(() => computeBalances(ledgers, vouchers), [ledgers, vouchers]);
  const todayStats = useMemo(() => {
    const t = todayISO(); let spent = 0, recv = 0;
    vouchers.filter(v => v.date === t).forEach(v => { const a = v.entries[0]?.amount||0; if (["Payment","Purchase"].includes(v.type)) spent+=a; if (["Receipt","Sales"].includes(v.type)) recv+=a; });
    return { spent, recv };
  }, [vouchers]);

  function addVoucher(draft) {
    const date = draft.date || todayISO();
    const alerts = computeAlerts(draft, date, { ledgers, vouchers, settings });
    const id = "v" + Date.now();
    const fallbackGroup = draft.type === "Journal" ? "Suspense A/c" : "Indirect Expenses";
    setLedgers(prev => { const names=new Set(prev.map(l=>l.name)); const add=[]; draft.entries.forEach(e=>{ if(e.ledger && !names.has(e.ledger)) add.push({name:e.ledger,group:e.group||fallbackGroup,opening:0}); }); return add.length?[...prev,...add]:prev; });
    setVouchers(prev => [{ id, date, type:draft.type, narration:draft.narration, party:draft.party||"", alerts,
      log: [{ at: new Date().toISOString(), action: "created", note: (draft.source==="photo"?"from scan":"by voice/typing") }],
      entries:draft.entries.filter(e=>e.ledger).map(({ledger,side,amount,group})=>({ledger,side,amount,group})) }, ...prev]);
    return id;
  }

  function downloadBackup() {
    const blob = new Blob([JSON.stringify({ user, companies, activeCo, settings, exportedAt: new Date().toISOString() }, null, 1)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a");
    a.href = url; a.download = `Karkoon_backup_${todayISO()}.json`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  }
  function restoreBackup(obj) {
    if (!obj || !obj.companies) throw new Error("bad file");
    setCompanies(obj.companies); setActiveCo(obj.activeCo || obj.companies[0].id);
    if (obj.settings) setSettings(prev => ({ ...prev, ...obj.settings }));
    if (obj.user) setUser(obj.user);
  }
  function addCompany(name) {
    const id = "c" + Date.now();
    setCompanies(prev => [...prev, { id, name, audit: [], vouchers: [], ledgers: [
      { name: "Capital A/c", group: "Capital Account", opening: 0 },
      { name: "Cash", group: "Cash-in-Hand", opening: 0 },
      { name: "Sales", group: "Sales Accounts", opening: 0 },
    ] }]);
    setActiveCo(id);
  }
  function importTallyMasters(xmlText) {
    const doc = new DOMParser().parseFromString(xmlText, "text/xml");
    const nodes = [...doc.querySelectorAll("LEDGER")];
    const found = nodes.map(n => {
      const name = n.getAttribute("NAME") || n.querySelector("NAME")?.textContent || "";
      const parent = n.querySelector("PARENT")?.textContent || "Suspense A/c";
      const ob = parseFloat(n.querySelector("OPENINGBALANCE")?.textContent || "0") || 0;
      return { name: name.trim(), group: GROUP_NAMES.includes(parent.trim()) ? parent.trim() : "Suspense A/c", opening: -ob };
    }).filter(l => l.name);
    let added = 0;
    setLedgers(prev => { const names = new Set(prev.map(l => l.name.toLowerCase())); const add = found.filter(l => !names.has(l.name.toLowerCase())); added = add.length; return add.length ? [...prev, ...add] : prev; });
    return { total: found.length, added };
  }

  function updateVoucher(nv) {
    setLedgers(prev => { const names=new Set(prev.map(l=>l.name)); const add=[]; nv.entries.forEach(e=>{ if(e.ledger && !names.has(e.ledger)) add.push({name:e.ledger,group:e.group||"Indirect Expenses",opening:0}); }); return add.length?[...prev,...add]:prev; });
    const draftLike = { type:nv.type, narration:nv.narration, party:nv.party||"", amount:nv.entries[0]?.amount||0, entries:nv.entries };
    const alerts = computeAlerts(draftLike, nv.date, { ledgers, vouchers, settings });
    setVouchers(prev => prev.map(x => {
      if (x.id !== nv.id) return x;
      const oldAmt = x.entries[0]?.amount, newAmt = nv.entries[0]?.amount;
      const log = [...(x.log||[]), { at: new Date().toISOString(), action: "edited", note: oldAmt!==newAmt ? `amount ₹${oldAmt} → ₹${newAmt}` : "details changed" }];
      return { ...nv, alerts, log };
    }));
  }
  function deleteVoucher(id) {
    const v = vouchers.find(x => x.id === id);
    if (v) pushAudit({ action: "voucher deleted", note: `${v.date} · ${v.type} · ₹${v.entries[0]?.amount||0} · ${v.narration||""}` });
    setVouchers(prev => prev.filter(x => x.id !== id));
  }
  function alterLedger(oldName, upd) {
    setLedgers(prev => prev.map(l => l.name===oldName ? { ...l, name: upd.name, group: upd.group, opening: upd.opening } : l));
    if (upd.name !== oldName) setVouchers(prev => prev.map(v => ({ ...v, party: v.party===oldName?upd.name:v.party, entries: v.entries.map(e => e.ledger===oldName ? { ...e, ledger: upd.name } : e) })));
  }
  function deleteLedger(name) { setLedgers(prev => prev.filter(l => l.name !== name)); }

  if (!ready) return <div style={{ background: PAPER }} className="min-h-screen grid place-items-center text-stone-400">Loading…</div>;

  return (
    <div style={{ background: "#EAE3DF" }} className="min-h-screen w-full flex justify-center p-3">
      <div style={{ background: PAPER, color: INK }} className="w-full max-w-[420px] rounded-[28px] overflow-hidden shadow-2xl flex flex-col relative">
        {view === "auth" && <Auth onGoogle={() => { setUser({ name:"You", via:"Google" }); setView("onboard"); }} onMobile={() => setView("otp")} />}
        {view === "otp" && <Otp onBack={() => setView("auth")} onDone={() => { setUser({ name:"You", via:"Mobile" }); setView("onboard"); }} />}
        {view === "onboard" && <Onboard settings={settings} setSettings={setSettings} onFinish={(needSetup, banks, cashOpen) => {
          setLedgers(prev => {
            let L = prev.slice();
            if (banks.length) L = L.filter(l => l.group !== "Bank Accounts");
            banks.forEach(b => L.push({ name: b.name, group: "Bank Accounts", opening: b.opening || 0 }));
            L = L.map(l => l.name === "Cash" ? { ...l, opening: cashOpen } : l);
            const assets = L.filter(l => ["Bank Accounts","Cash-in-Hand"].includes(l.group)).reduce((s,l)=>s+(l.opening||0),0);
            return L.map(l => l.name === "Capital A/c" ? { ...l, opening: -assets } : l);
          });
          setView(needSetup ? "setup" : "app");
        }} />}
        {view === "setup" && <Setup ledgers={ledgers} setLedgers={setLedgers} onDone={() => setView("app")} />}
        {view === "app" && (
          <AppShell
            tab={tab} setTab={(t)=>{setReport(null);setTab(t);}} report={report} setReport={setReport}
            ledgers={ledgers} vouchers={vouchers} balances={balances} todayStats={todayStats} addVoucher={addVoucher}
            updateVoucher={updateVoucher} deleteVoucher={deleteVoucher} alterLedger={alterLedger} deleteLedger={deleteLedger}
            importTallyMasters={importTallyMasters} bizName={co.name}
            settings={settings} cfg={cfg} openSettings={() => setShowSettings(true)}
          />
        )}
        {showSettings && view === "app" && (
          <SettingsSheet settings={settings} setSettings={setSettings} onClose={() => setShowSettings(false)}
            companies={companies} activeCo={activeCo} onSwitchCo={(id)=>setActiveCo(id)} onAddCo={addCompany}
            onBackup={downloadBackup} onRestore={restoreBackup}
            onReset={() => { setLedgers(seedLedgers); setVouchers(seedVouchers); }} />
        )}
        {locked && view === "app" && <LockScreen pin={settings.pin} onUnlock={()=>setLocked(false)} />}
      </div>
    </div>
  );
}

/* ===== Lock screen ===== */
function LockScreen({ pin, onUnlock }) {
  const [val, setVal] = useState(""); const [err, setErr] = useState(false);
  return (
    <div className="absolute inset-0 z-50 flex flex-col items-center justify-center p-8" style={{ background: PAPER }}>
      <Logo size={54} />
      <h2 className="text-xl font-bold mt-4">Karkoon is locked</h2>
      <p className="text-stone-500 text-sm mt-1 mb-5">Enter your PIN</p>
      <input autoFocus type="password" inputMode="numeric" value={val}
        onChange={e => { const v = e.target.value.replace(/\D/g, "").slice(0, 6); setVal(v); setErr(false); if (v === pin) onUnlock(); }}
        className="w-40 text-center tracking-[0.4em] text-2xl font-mono bg-white border rounded-xl py-3 outline-none"
        style={{ borderColor: err ? EXP : HAIR }} placeholder="••••" />
      <button onClick={() => { if (val === pin) onUnlock(); else setErr(true); }} style={{ background: BURGUNDY }} className="mt-4 text-white rounded-xl px-8 py-3 font-semibold text-sm">Unlock</button>
      {err && <p className="text-xs mt-3" style={{ color: EXP }}>Wrong PIN — try again</p>}
    </div>
  );
}

/* ===== Auth ===== */
function Auth({ onGoogle, onMobile }) {
  const [mobile, setMobile] = useState("");
  return (
    <div className="p-6 flex flex-col min-h-[640px]">
      <div className="text-center pt-10 pb-7">
        <div className="mx-auto mb-4 w-16 h-16 rounded-2xl grid place-items-center" style={{ background: SOFT }}><Logo size={40} /></div>
        <Wordmark size={26} />
        <p className="text-stone-500 text-sm mt-2">Speak. Karkoon keeps your books.</p>
      </div>
      <button onClick={onGoogle} className="w-full bg-white border rounded-xl py-3.5 font-semibold text-sm flex items-center justify-center gap-2.5 active:scale-[.99] transition" style={{ borderColor: HAIR }}>
        <svg width="18" height="18" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.5 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.9a5 5 0 0 1-2.2 3.3v2.7h3.6c2.1-1.9 3.2-4.8 3.2-7.8Z"/><path fill="#34A853" d="M12 23c2.9 0 5.4-1 7.2-2.6l-3.6-2.7c-1 .7-2.3 1.1-3.6 1.1-2.8 0-5.1-1.9-6-4.4H2.3v2.8A11 11 0 0 0 12 23Z"/><path fill="#FBBC05" d="M6 14.4a6.6 6.6 0 0 1 0-4.2V7.4H2.3a11 11 0 0 0 0 9.8L6 14.4Z"/><path fill="#EA4335" d="M12 5.6c1.6 0 3 .5 4.1 1.6l3.1-3.1A11 11 0 0 0 2.3 7.4L6 10.2C6.9 7.6 9.2 5.6 12 5.6Z"/></svg>
        Continue with Google
      </button>
      <div className="flex items-center gap-2.5 text-stone-400 text-xs my-4"><div className="flex-1 h-px" style={{ background: HAIR }} />or use mobile<div className="flex-1 h-px" style={{ background: HAIR }} /></div>
      <div className="bg-white border rounded-xl px-3.5 py-3 flex items-center mb-3" style={{ borderColor: HAIR }}>
        <span className="text-stone-400 text-sm">+91</span>
        <input value={mobile} onChange={e=>setMobile(e.target.value.replace(/\D/g,"").slice(0,10))} placeholder="98765 43210" className="flex-1 outline-none ml-2.5 text-[15px] bg-transparent" inputMode="numeric" />
      </div>
      <button onClick={onMobile} disabled={mobile.length<10} style={{ background: mobile.length<10?"#C9A9B2":BURGUNDY }} className="w-full text-white rounded-xl py-3.5 font-semibold text-sm transition active:scale-[.99]">Send OTP</button>
      <div className="mt-auto pt-6 grid grid-cols-2 gap-2">
        <BrandSwatch variant="light" /><BrandSwatch variant="dark" />
      </div>
    </div>
  );
}
function BrandSwatch({ variant }) {
  const dark = variant === "dark";
  return (
    <div className="rounded-xl p-3 flex items-center gap-2 border" style={{ background: dark ? "#1c1116" : "#fff", borderColor: dark ? "#2c1a20" : HAIR }}>
      <Logo size={22} variant={variant} /><Wordmark size={13} variant={variant} />
    </div>
  );
}

function Otp({ onBack, onDone }) {
  const [code, setCode] = useState("");
  return (
    <div className="p-6 flex flex-col min-h-[640px]">
      <button onClick={onBack} className="text-stone-500 flex items-center gap-1 text-sm mb-6 mt-2"><ChevronLeft size={18}/>Back</button>
      <h2 className="text-2xl font-bold tracking-tight">Enter the code</h2>
      <p className="text-stone-500 text-sm mt-1.5 mb-6">Sent to <b className="text-stone-800">+91 98765 43210</b></p>
      <input autoFocus value={code} onChange={e=>setCode(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="• • • • • •" inputMode="numeric" className="w-full text-center tracking-[0.5em] text-2xl font-mono bg-white border rounded-xl py-4 outline-none mb-5" style={{ borderColor: HAIR }} />
      <button onClick={onDone} disabled={code.length<4} style={{ background: code.length<4?"#C9A9B2":BURGUNDY }} className="w-full text-white rounded-xl py-3.5 font-semibold text-sm active:scale-[.99] transition">Verify &amp; continue</button>
      <div className="mt-6 rounded-xl p-3 text-[11.5px] leading-relaxed" style={{ background: SOFT, color: BURGUNDY }}>🔒 Your books stay private to your account. (Demo: enter any 4–6 digits.)</div>
    </div>
  );
}

/* ===== Onboarding: account type + mode ===== */
function Onboard({ settings, setSettings, onFinish }) {
  const [step, setStep] = useState(0);
  const [setupChoice, setSetupChoice] = useState("auto");
  const [banks, setBanks] = useState([{ name: "", opening: "" }]);
  const [cashOpen, setCashOpen] = useState("");
  const types = [
    { id: "business", icon: <Building2 size={18} />, label: "Business", sub: "Trading / shop / company" },
    { id: "profession", icon: <Briefcase size={18} />, label: "Profession", sub: "CA, doctor, consultant, freelancer" },
    { id: "ngo", icon: <Heart size={18} />, label: "NGO / Trust", sub: "Society, trust, charitable body" },
    { id: "personal", icon: <User size={18} />, label: "Personal", sub: "Household / personal money" },
  ];
  const modes = [
    { id: "complete", icon: <Layers size={18} />, label: "Do complete accounts here", sub: "Full double-entry → P&L, Balance Sheet, the works." },
    { id: "rnp", icon: <ArrowLeftRight size={18} />, label: "Only record receipts & payments", sub: "You use other software. Here just capture cash/bank in & out, then export." },
  ];
  const Choice = ({ sel, id, icon, label, sub, onPick }) => (
    <button onClick={() => onPick(id)} style={sel===id?{borderColor:BURGUNDY,background:SOFT}:{borderColor:HAIR}} className="w-full text-left border-[1.5px] rounded-2xl p-4 mb-3 bg-white transition flex items-start gap-3">
      <span className="w-9 h-9 rounded-xl grid place-items-center shrink-0" style={{ background: sel===id?BURGUNDY:TINT, color: sel===id?"#fff":BURGUNDY }}>{icon}</span>
      <div className="flex-1"><div className="font-bold text-[14.5px]">{label}</div><div className="text-stone-500 text-xs mt-0.5 leading-snug">{sub}</div></div>
      <span style={sel===id?{borderColor:BURGUNDY,background:BURGUNDY,boxShadow:"inset 0 0 0 3px #fff"}:{borderColor:HAIR}} className="w-5 h-5 rounded-full border-2 mt-1 shrink-0" />
    </button>
  );
  return (
    <div className="p-6 flex flex-col min-h-[640px]">
      <div className="flex items-center gap-2 mb-1"><Logo size={22} /><Wordmark size={15} /></div>
      <p className="text-[10px] font-semibold tracking-widest uppercase text-stone-400 mt-4 mb-2">Set up · step {step+1} of 3</p>
      {step === 0 ? (<>
        <h2 className="text-[22px] font-bold tracking-tight leading-tight">What are you keeping accounts for?</h2>
        <p className="text-stone-500 text-sm mt-1.5 mb-4">Tailors your ledgers and report titles.</p>
        {types.map(t => <Choice key={t.id} sel={settings.accountType} {...t} onPick={(id)=>setSettings(s=>({...s,accountType:id}))} />)}
        <button onClick={()=>setStep(1)} style={{ background: BURGUNDY }} className="w-full text-white rounded-xl py-3.5 font-semibold text-sm mt-1 active:scale-[.99] transition">Next</button>
      </>) : (<>
        <h2 className="text-[22px] font-bold tracking-tight leading-tight">How will you use Karkoon?</h2>
        <p className="text-stone-500 text-sm mt-1.5 mb-4">You can switch this later in Settings.</p>
        {modes.map(m => <Choice key={m.id} sel={settings.mode} {...m} onPick={(id)=>setSettings(s=>({...s,mode:id}))} />)}
        <div className="rounded-xl p-3 mb-3 text-[11.5px] leading-relaxed" style={{ background: TINT, color: BURGUNDY_DK }}>
          Then: <b>create ledgers now</b> or <b>let Karkoon create them as you speak</b>?
          <div className="flex gap-2 mt-2">
            {[["auto","As I go"],["define","I'll name them"]].map(([id,lb])=>(
              <button key={id} onClick={()=>setSetupChoice(id)} style={setupChoice===id?{background:BURGUNDY,color:"#fff"}:{background:"#fff",color:BURGUNDY}} className="flex-1 rounded-lg py-2 text-xs font-semibold border" >{lb}</button>
            ))}
          </div>
        </div>
        <button onClick={()=>setStep(2)} style={{ background: BURGUNDY }} className="w-full text-white rounded-xl py-3.5 font-semibold text-sm active:scale-[.99] transition">Next</button>
      </>)}
      {step === 2 && (<>
        <h2 className="text-[22px] font-bold tracking-tight leading-tight">Your bank accounts</h2>
        <p className="text-stone-500 text-sm mt-1.5 mb-1">Add the banks you use, with opening balances.</p>
        <div className="rounded-xl p-2.5 mb-3 text-[11px] leading-relaxed" style={{background:TINT,color:BURGUNDY_DK}}>Tip: use the <b>same ledger names as in your Tally</b> (e.g. “SBI Bank A/c”) so exports import cleanly.</div>
        {banks.map((b,i)=>(
          <div key={i} className="flex gap-2 mb-2">
            <input value={b.name} onChange={e=>setBanks(p=>p.map((x,j)=>j===i?{...x,name:e.target.value}:x))} placeholder="Bank ledger name" className="flex-[2] outline-none text-sm border rounded-lg px-3 py-2.5 bg-white" style={{borderColor:HAIR}} />
            <input value={b.opening} onChange={e=>setBanks(p=>p.map((x,j)=>j===i?{...x,opening:e.target.value.replace(/[^\d.-]/g,"")}:x))} placeholder="Opening ₹" inputMode="numeric" className="flex-1 outline-none text-sm border rounded-lg px-3 py-2.5 bg-white font-mono" style={{borderColor:HAIR}} />
          </div>
        ))}
        <button onClick={()=>setBanks(p=>[...p,{name:"",opening:""}])} className="text-xs font-semibold mb-3" style={{color:BURGUNDY}}>+ Add another bank</button>
        <div className="flex gap-2 mb-3 items-center">
          <span className="text-sm font-semibold flex-[2]">Cash in hand (opening)</span>
          <input value={cashOpen} onChange={e=>setCashOpen(e.target.value.replace(/[^\d.-]/g,""))} placeholder="₹" inputMode="numeric" className="flex-1 outline-none text-sm border rounded-lg px-3 py-2.5 bg-white font-mono" style={{borderColor:HAIR}} />
        </div>
        <button onClick={()=>onFinish(setupChoice==="define", banks.filter(b=>b.name.trim()).map(b=>({name:b.name.trim(),opening:parseFloat(b.opening)||0})), parseFloat(cashOpen)||0)} style={{ background: BURGUNDY }} className="w-full text-white rounded-xl py-3.5 font-semibold text-sm active:scale-[.99] transition">Start using Karkoon</button>
        <button onClick={()=>onFinish(setupChoice==="define", [], 0)} className="w-full text-stone-400 text-xs py-3">Skip — add banks later</button>
      </>)}
    </div>
  );
}

/* ===== Ledger setup ===== */
function Setup({ ledgers, setLedgers, onDone }) {
  const [name, setName] = useState(""); const [group, setGroup] = useState("Indirect Expenses");
  const grouped = useMemo(() => { const g={}; ledgers.forEach(l=>{(g[l.group]=g[l.group]||[]).push(l);}); return g; }, [ledgers]);
  return (
    <div className="flex flex-col min-h-[640px]">
      <Header title="Add ledgers" />
      <div className="px-4 flex-1 overflow-y-auto">
        <p className="text-stone-500 text-xs mb-3">Grouped as per Tally Prime.</p>
        {Object.entries(grouped).map(([g,ls])=>(
          <div key={g} className="mb-3"><p className="text-[11px] font-semibold text-stone-500 mb-1.5">{g}</p>
            {ls.map(l=>(<div key={l.name} className="bg-white border rounded-xl px-3 py-2.5 mb-1.5 flex items-center justify-between" style={{borderColor:HAIR}}><span className="text-sm font-semibold">{l.name}</span>{l.opening?<span className="text-[11px] text-stone-400 font-mono">Op. {fmt(l.opening)}</span>:null}</div>))}
          </div>
        ))}
        <div className="bg-white border rounded-2xl p-3 mt-2" style={{borderColor:HAIR}}>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="New ledger name" className="w-full outline-none text-sm border rounded-lg px-3 py-2.5 mb-2" style={{borderColor:HAIR}} />
          <select value={group} onChange={e=>setGroup(e.target.value)} className="w-full text-sm border rounded-lg px-3 py-2.5 mb-2 bg-white" style={{borderColor:HAIR}}>{GROUP_NAMES.map(g=><option key={g}>{g}</option>)}</select>
          <button onClick={()=>{if(name.trim()){setLedgers(p=>[...p,{name:name.trim(),group,opening:0}]);setName("");}}} style={{color:BURGUNDY,background:TINT}} className="w-full rounded-lg py-2.5 font-semibold text-sm flex items-center justify-center gap-1.5"><Plus size={16}/>Add ledger</button>
        </div>
      </div>
      <div className="p-4"><button onClick={onDone} style={{background:BURGUNDY}} className="w-full text-white rounded-xl py-3.5 font-semibold text-sm active:scale-[.99] transition">Done — start using</button></div>
    </div>
  );
}

function Header({ title, right }) {
  return (<div className="px-4 pt-5 pb-3 flex items-center justify-between shrink-0">
    <div className="flex items-center gap-2"><Logo size={26} /><b className="text-[15px]">{title}</b></div>{right}
  </div>);
}

/* ===== App shell ===== */
function AppShell({ tab, setTab, report, setReport, ledgers, vouchers, balances, todayStats, addVoucher, updateVoucher, deleteVoucher, alterLedger, deleteLedger, importTallyMasters, bizName, settings, cfg, openSettings }) {
  return (
    <div className="flex flex-col min-h-[660px]">
      <div className="flex-1 overflow-y-auto">
        {report === "pl" ? <ProfitLoss ledgers={ledgers} vouchers={vouchers} cfg={cfg} onBack={()=>setReport(null)} />
          : report === "bs" ? <BalanceSheet ledgers={ledgers} vouchers={vouchers} onBack={()=>setReport(null)} />
          : report === "tb" ? <TrialBalance ledgers={ledgers} vouchers={vouchers} onBack={()=>setReport(null)} />
          : report === "rnp" ? <ReceiptsPayments ledgers={ledgers} vouchers={vouchers} onBack={()=>setReport(null)} />
          : report === "export" ? <ExportTally ledgers={ledgers} vouchers={vouchers} importTallyMasters={importTallyMasters} onBack={()=>setReport(null)} />
          : report === "out" ? <Outstanding ledgers={ledgers} vouchers={vouchers} balances={balances} onBack={()=>setReport(null)} />
          : report === "audit" ? <AuditTrail vouchers={vouchers} onBack={()=>setReport(null)} />
          : tab === "speak" ? <Speak todayStats={todayStats} addVoucher={addVoucher} deleteVoucher={deleteVoucher} cfg={cfg} settings={settings} openSettings={openSettings} ledgers={ledgers} vouchers={vouchers} bizName={bizName} />
          : tab === "ledgers" ? <Ledgers ledgers={ledgers} balances={balances} vouchers={vouchers} onAlter={alterLedger} onDelete={deleteLedger} />
          : tab === "daybook" ? <DayBook vouchers={vouchers} onUpdate={updateVoucher} onDelete={deleteVoucher} bizName={bizName} />
          : <Reports setReport={setReport} settings={settings} cfg={cfg} />}
      </div>
      <Nav tab={tab} setTab={setTab} report={report} />
    </div>
  );
}

function Nav({ tab, setTab, report }) {
  const items = [
    { id:"speak", label:"Speak", icon:<path d="M3 12h7l2-4 3 8 2-4h4"/> },
    { id:"ledgers", label:"Ledgers", icon:<><path d="M4 4h12a2 2 0 0 1 2 2v14H6a2 2 0 0 1-2-2Z"/><path d="M8 8h6M8 12h6"/></> },
    { id:"daybook", label:"Day Book", icon:<><rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="13" width="16" height="7" rx="1"/></> },
    { id:"reports", label:"Reports", icon:<path d="M6 20v-7M12 20V6M18 20v-10"/> },
  ];
  const active = (id) => !report && tab === id;
  return (<div className="flex bg-white border-t px-2 pt-1.5 pb-2 shrink-0" style={{ borderColor: HAIR }}>
    {items.map(it=>(<button key={it.id} onClick={()=>setTab(it.id)} className="flex-1 flex flex-col items-center gap-0.5 py-1.5" style={{ color: active(it.id)?BURGUNDY:"#9CA3AF" }}>
      <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">{it.icon}</svg>
      <span className="text-[10px] font-medium">{it.label}</span></button>))}
  </div>);
}

/* ===== Speak ===== */
function Speak({ todayStats, addVoucher, deleteVoucher, cfg, settings, openSettings, ledgers, vouchers, bizName }) {
  const [listening, setListening] = useState(false); const [showEx, setShowEx] = useState(false);
  const [draft, setDraft] = useState(null); const [manual, setManual] = useState(""); const [supported, setSupported] = useState(true);
  const [wakeOn, setWakeOn] = useState(false); const [wakeState, setWakeState] = useState("idle"); // idle|armed|heard|capturing
  const recRef = useRef(null); const wakeRef = useRef(null); const wakeOnRef = useRef(false); const capturingRef = useRef(false);
  const cfgRef = useRef(cfg); useEffect(()=>{ cfgRef.current = cfg; }, [cfg]);
  const [scanning, setScanning] = useState(false); const [scanErr, setScanErr] = useState("");
  const [clarify, setClarify] = useState(null); // {d, count}
  const [undoId, setUndoId] = useState(null); const undoTimer = useRef(null);
  const [journal, setJournal] = useState(false);
  function savedToast(id){ setUndoId(id); clearTimeout(undoTimer.current); undoTimer.current = setTimeout(()=>setUndoId(null), 6000); }
  function analyze(text){
    let d = postProcess(parseSpeech(text, cfgRef.current), ledgers);
    const issues = validateDraft(d, ledgers);
    if (issues.length) setClarify({ d, count: 0 }); else setDraft(d);
  }
  function answerClarify(issue, answer){
    let d2 = applyAnswer(clarify.d, issue, answer, cfgRef.current);
    d2 = postProcess(d2, ledgers);
    const count = clarify.count + 1;
    const issues = validateDraft(d2, ledgers);
    if (!issues.length || count >= 2 || d2.forceReview) { setClarify(null); setDraft(d2); }
    else setClarify({ d: d2, count });
  }
  const fileRef = useRef(null);
  const SR = (typeof window!=="undefined") && (window.SpeechRecognition||window.webkitSpeechRecognition);
  const isNative = (typeof window!=="undefined") && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  async function nativeCapture(){
    try{
      const { SpeechRecognition: N } = await import("@capacitor-community/speech-recognition");
      const perm = await N.requestPermissions(); if(perm && perm.speechRecognition==="denied"){ setScanErr("Microphone permission denied."); return; }
      setListening(true);
      const res = await N.start({ language: settings.lang||"en-IN", maxResults: 1, partialResults: false, popup: false });
      const text = res && res.matches && res.matches[0];
      handleEntryText(text||"");
    }catch(e){ setListening(false); }
  }
  const WAKE_RE = /hey[\s,]+(kar+k?o+n?|car\s?coon|karku+n)/i; // "hey karkoon" + common mishears

  function handleEntryText(text){
    capturingRef.current=false; setListening(false); setWakeState(wakeOnRef.current?"armed":"idle");
    const tx=(text||"").trim(); if(tx){ setManual(tx); analyze(tx); }
  }
  function startCapture(){ if(!recRef.current) return; try{ capturingRef.current=true; setListening(true); recRef.current.start(); }catch(e){} }
  function stopWake(updateState=true){ try{ wakeRef.current && wakeRef.current.stop(); }catch(e){} if(updateState) setWakeState("idle"); }
  function startWake(){
    if(!SR){ setSupported(false); return; }
    try{
      const w=new SR(); w.lang=settings.lang||"en-IN"; w.continuous=true; w.interimResults=true;
      w.onresult=(e)=>{ if(capturingRef.current) return;
        let txt=""; for(let i=e.resultIndex;i<e.results.length;i++){ txt+=e.results[i][0].transcript+" "; }
        const m=txt.match(WAKE_RE);
        if(m){ const after=txt.slice(txt.toLowerCase().indexOf(m[0].toLowerCase())+m[0].length).trim();
          stopWake(false); setWakeState("heard");
          if(after && /\d/.test(after)) setTimeout(()=>handleEntryText(after),200);
          else { setWakeState("capturing"); setTimeout(startCapture,280); }
        }
      };
      w.onerror=()=>{};
      w.onend=()=>{ if(wakeOnRef.current && !capturingRef.current){ try{ w.start(); }catch(e){} } };
      wakeRef.current=w; w.start(); setWakeState("armed");
    }catch(e){ setSupported(false); }
  }
  function toggleWake(){ if(!supported) return; const next=!wakeOn; setWakeOn(next); wakeOnRef.current=next; if(next) startWake(); else stopWake(true); }

  useEffect(() => {
    if (!SR) { if(!isNative) setSupported(false); return; }
    const r = new SR(); r.lang = settings.lang||"en-IN"; r.interimResults=false; r.maxAlternatives=1;
    r.onresult = (e)=>{ handleEntryText(e.results[0][0].transcript); };
    r.onerror = ()=>{ setListening(false); capturingRef.current=false;
      if(wakeOnRef.current){ setWakeState("armed"); setTimeout(()=>{ try{ wakeRef.current?wakeRef.current.start():startWake(); }catch(e){} },300); } else setWakeState("idle"); };
    r.onend = ()=>{ setListening(false); };
    recRef.current = r;
    return ()=>{ try{ r.abort(); }catch(e){} };
  }, [SR, settings.lang]);

  useEffect(()=>{
    if(!draft && wakeOnRef.current && !capturingRef.current){ const id=setTimeout(()=>{ try{ wakeRef.current?wakeRef.current.start():startWake(); }catch(e){} },350); return ()=>clearTimeout(id); }
    if(draft){ try{ wakeRef.current && wakeRef.current.stop(); }catch(e){} }
  }, [draft]);
  useEffect(()=>()=>{ wakeOnRef.current=false; try{ wakeRef.current && wakeRef.current.abort(); }catch(e){} }, []);

  function tapMic(){ setShowEx(false); if(isNative){ nativeCapture(); return; } if(!supported) return; stopWake(false); startCapture(); }
  function runManual(){ if(manual.trim()) analyze(manual.trim()); }
  function openCamera(){ setShowEx(false); setScanErr(""); if(fileRef.current) fileRef.current.click(); }
  async function onFile(e){
    const f = e.target.files && e.target.files[0]; e.target.value=""; if(!f) return;
    let dataUrl; try{ dataUrl = await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=rej;r.readAsDataURL(f);}); }catch(err){ setScanErr("Couldn't read that image."); return; }
    setScanErr(""); setScanning(true);
    try{ const dr = await scanDocument(dataUrl, f.type||"image/jpeg", cfgRef.current, settings.scanKey); setScanning(false); setDraft(dr); }
    catch(err){ setScanning(false); setScanErr(settings.scanKey ? "Couldn't scan that — try a sharper, well-lit photo, or type the entry." : "Scanning needs an AI key here — add one in Settings → Document scan, or type the entry."); }
  }
  const getAlerts = (d, date) => computeAlerts(d, date, { ledgers, vouchers, settings });
  if (draft) return <Review draft={draft} heard={manual} getAlerts={getAlerts} settings={settings} banks={ledgers.filter(l=>l.group==="Bank Accounts")} onCancel={()=>{setDraft(null);setManual("");}} onSave={(d)=>{const id=addVoucher(d);setDraft(null);setManual("");savedToast(id);}} />;
  const examples = [
    ["Paid 1,200 to Sharma Stationers for office supplies","Payment · Expense"],
    ["Bought laptop 55,000 by SBI bank","Payment · Fixed Asset"],
    [`Received 12,000 from Janani as ${cfg.income.toLowerCase()}`,"Receipt · Income"],
    ["Cash sales 5,000","Sales"],
  ];
  return (
    <div className="flex flex-col min-h-[600px] relative">
      <Header title="Karkoon" right={<div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold px-2.5 py-1.5 rounded-full" style={{background:TINT,color:BURGUNDY}}>{cfg.label}</span>
        <button onClick={openSettings} className="text-stone-400"><Settings size={20}/></button>
      </div>} />
      <div className="px-4">
        <div className="bg-white border rounded-2xl px-4 py-3.5 flex justify-between items-end" style={{borderColor:HAIR}}>
          <div><div className="text-[11px] text-stone-500">Paid today</div><div className="text-[22px]"><Money n={todayStats.spent} kind="e"/></div></div>
          <div className="text-right"><div className="text-[11px] text-stone-500">Received</div><div className="text-[22px]"><Money n={todayStats.recv} kind="i"/></div></div>
        </div>
      </div>
      <div className="flex flex-col items-center pt-7 pb-4">
        <button onClick={tapMic} style={{background:BURGUNDY,boxShadow:`0 12px 30px -8px ${BURGUNDY}99`}} className="w-[104px] h-[104px] rounded-full grid place-items-center text-white relative active:scale-95 transition">
          {(listening || wakeState==="armed" || wakeState==="heard" || wakeState==="capturing") && <span style={{borderColor:GOLD}} className="absolute -inset-2 rounded-full border-2 animate-ping"/>}
          <Mic size={40}/>
        </button>
        <div className="mt-4 font-bold text-[16px]">{listening?"Listening…":wakeState==="heard"?"Heard you!":wakeState==="capturing"?"Go ahead…":wakeOn?"Say “Hey Karkoon”":"Tap & speak"}</div>
        <div className="text-stone-500 text-xs mt-1">{!supported?"voice not available here — type below":wakeOn?"wake word on — or just tap":'tap the mic, or turn on “Hey Karkoon”'}</div>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onFile} className="hidden" />
        <button onClick={openCamera} className="mt-3 flex items-center gap-2 px-4 py-2.5 rounded-full text-sm font-semibold active:scale-[.98] transition" style={{background:BURGUNDY,color:"#fff",boxShadow:`0 8px 20px -8px ${BURGUNDY}88`}}>
          <Camera size={18}/> Scan invoice · receipt · cheque
        </button>
        <div className="flex flex-col items-center gap-2 mt-2">
          <button onClick={toggleWake} disabled={!SR} style={{background:wakeOn?BURGUNDY:TINT,color:wakeOn?"#fff":BURGUNDY,opacity:SR?1:.5}} className="text-xs font-semibold px-3.5 py-2 rounded-full flex items-center gap-2">
            <span className="relative flex h-2 w-2">{wakeOn && <span style={{background:GOLD}} className="absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping"/>}<span style={{background:wakeOn?GOLD:BURGUNDY}} className="relative inline-flex rounded-full h-2 w-2"/></span>
            {wakeOn?'Listening for “Hey Karkoon”':(!SR&&isNative)?'“Hey Karkoon” wake — coming to APK':'Enable “Hey Karkoon” wake'}
          </button>
          <button onClick={()=>setShowEx(true)} style={{background:TINT,color:BURGUNDY}} className="text-xs font-semibold px-3.5 py-2 rounded-full flex items-center gap-1.5"><Sparkles size={14}/>See example entries</button>
        </div>
      </div>
      <div className="px-4 mt-1">
        <div className="bg-white border rounded-2xl p-3" style={{borderColor:HAIR}}>
          <div className="flex items-center justify-between mb-2">
            <p className="text-[11px] font-semibold text-stone-500">Or type an entry</p>
            <button onClick={()=>setJournal(true)} className="text-[11px] font-semibold" style={{color:BURGUNDY}}>✍️ Manual journal</button>
          </div>
          <div className="flex gap-2">
            <input value={manual} onChange={e=>setManual(e.target.value)} onKeyDown={e=>e.key==="Enter"&&runManual()} placeholder="e.g. Paid 500 cash for tea" className="flex-1 outline-none text-sm border rounded-lg px-3 py-2.5" style={{borderColor:HAIR}} />
            <button onClick={runManual} style={{background:BURGUNDY}} className="text-white rounded-lg px-3.5 grid place-items-center"><ArrowRight size={18}/></button>
          </div>
        </div>
      </div>
      {showEx && (<>
        <div onClick={()=>setShowEx(false)} style={{background:"rgba(36,19,24,.35)"}} className="absolute inset-0 z-10"/>
        <div className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl p-4 pb-6 z-20" style={{boxShadow:"0 -20px 40px -20px rgba(0,0,0,.4)"}}>
          <div className="w-9 h-1 rounded-full mx-auto mb-3" style={{background:HAIR}}/>
          <h3 className="text-[17px] font-bold mb-0.5">Try saying…</h3>
          <p className="text-stone-500 text-xs mb-3">Karkoon detects whether it's an expense, an asset, or income.</p>
          {examples.map(([q,sub],i)=>(<button key={i} onClick={()=>{setManual(q);analyze(q);setShowEx(false);}} style={{background:PAPER}} className="w-full text-left rounded-xl px-3 py-2.5 mb-1.5 flex gap-2.5 items-start">
            <span style={{color:GOLD}} className="font-bold">“</span><span className="text-[12.5px] leading-snug">{q}<span className="block text-[11px] text-stone-400 mt-0.5">{sub}</span></span>
          </button>))}
          <button onClick={tapMic} style={{background:BURGUNDY}} className="w-full text-white rounded-xl py-3 font-semibold text-sm mt-2 flex items-center justify-center gap-2"><Mic size={17}/>Start speaking</button>
        </div>
      </>)}
      {undoId && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-24 bg-stone-900 text-white text-xs pl-4 pr-2 py-2 rounded-full z-30 flex items-center gap-3">
          Voucher saved
          <button onClick={()=>{deleteVoucher(undoId);setUndoId(null);}} className="font-bold px-3 py-1.5 rounded-full" style={{background:GOLD,color:"#3a2a08"}}>UNDO</button>
        </div>
      )}
      {journal && <VoucherEditSheet v={{ id:null, date: todayISO(), type: "Journal", narration: "", entries: [{ledger:"",side:"dr",amount:0},{ledger:"",side:"cr",amount:0}] }}
        onClose={()=>setJournal(false)}
        onSave={(nv)=>{ const id=addVoucher({ ...nv, party:"", amount:nv.entries[0]?.amount||0 }); setJournal(false); savedToast(id); }}
        onDelete={()=>setJournal(false)} bizName={bizName} />}
      {clarify && <ClarifySheet clarify={clarify} ledgers={ledgers} onAnswer={answerClarify} onSkip={()=>{ setDraft(clarify.d); setClarify(null); }} onCancel={()=>setClarify(null)} />}
      {scanning && (
        <div style={{background:"rgba(36,19,24,.55)"}} className="absolute inset-0 z-30 flex flex-col items-center justify-center text-white">
          <div className="w-12 h-12 rounded-full border-2 border-white/30 border-t-white animate-spin mb-4"/>
          <div className="font-semibold">Scanning document…</div>
          <div className="text-white/70 text-xs mt-1">Reading amount, party, date &amp; GST</div>
        </div>
      )}
      {scanErr && <div className="absolute left-1/2 -translate-x-1/2 bottom-24 bg-stone-900 text-white text-[11px] px-4 py-2.5 rounded-2xl z-30 text-center max-w-[85%] leading-snug">{scanErr}</div>}
    </div>
  );
}

/* ===== ClarifySheet: one-question follow-up (max 2) ===== */
function ClarifySheet({ clarify, ledgers, onAnswer, onSkip, onCancel }) {
  const issues = validateDraft(clarify.d, ledgers);
  const issue = issues[0];
  const [free, setFree] = useState("");
  if (!issue) return null;
  return (<>
    <div onClick={onCancel} style={{background:"rgba(36,19,24,.4)"}} className="absolute inset-0 z-20"/>
    <div className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl p-4 pb-6 z-30" style={{boxShadow:"0 -20px 40px -20px rgba(0,0,0,.4)"}}>
      <div className="w-9 h-1 rounded-full mx-auto mb-3" style={{background:HAIR}}/>
      <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-1">Quick check {clarify.count+1} of 2</p>
      <h3 className="text-[16px] font-bold mb-1">{issue.q}</h3>
      <p className="text-stone-500 text-[11px] mb-3 leading-snug">Heard: “{clarify.d.narration}”</p>
      {issue.type === "chips" && (
        <div className="flex flex-wrap gap-2 mb-2">
          {issue.chips.map(c => (
            <button key={c} onClick={()=>onAnswer(issue, c)} className="px-3.5 py-2.5 rounded-xl text-[13px] font-semibold border" style={{borderColor:BURGUNDY, color:BURGUNDY, background:SOFT}}>{c}</button>
          ))}
        </div>
      )}
      {(issue.type === "amount" || issue.type === "free" || issue.free) && (
        <div className="flex gap-2 mb-2">
          <input autoFocus={issue.type!=="chips"} value={free} onChange={e=>setFree(e.target.value)} onKeyDown={e=>e.key==="Enter"&&free.trim()&&onAnswer(issue, free.trim())}
            inputMode={issue.type==="amount"?"numeric":"text"} placeholder={issue.type==="amount"?"Amount ₹":"Type your answer…"}
            className="flex-1 outline-none text-sm border rounded-xl px-3 py-3" style={{borderColor:HAIR}} />
          <button onClick={()=>free.trim()&&onAnswer(issue, free.trim())} style={{background:BURGUNDY}} className="text-white rounded-xl px-4 font-semibold text-sm">OK</button>
        </div>
      )}
      <button onClick={onSkip} className="w-full text-stone-400 text-xs py-2.5">Skip — I’ll fix in Review</button>
    </div>
  </>);
}

/* ===== Review ===== */
function Review({ draft, heard, getAlerts, banks = [], settings = {}, onCancel, onSave }) {
  const [d, setD] = useState(draft); const [date, setDate] = useState(draft.date||todayISO());
  const alerts = getAlerts ? getAlerts(d, date) : [];
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  useEffect(() => {
    if (settings.readBack === false || typeof window === "undefined" || !window.speechSynthesis) return;
    try {
      const dr0 = d.entries.find(e=>e.side==="dr"), cr0 = d.entries.find(e=>e.side==="cr");
      const u = new SpeechSynthesisUtterance(`${d.type}. ${Math.round(d.amount)} rupees. ${dr0?.ledger} to ${cr0?.ledger}. Confirm?`);
      u.lang = settings.lang || "en-IN"; window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
    } catch (e) {}
    return () => { try { window.speechSynthesis.cancel(); } catch (e) {} };
  }, []);
  const gstEligible = settings.gstRegistered && !settings.composition && (d.type === "Sales" || d.type === "Purchase");
  function applyGst(rate, igst) {
    setD(p => { const r = gstSplitEntries(p, rate, igst); return { ...p, ...r }; });
  }
  function cycleMode(){
    const opts = ["Cash", ...banks.map(b=>b.name)];
    const cur = d.entries.find(e=>["Cash-in-Hand","Bank Accounts"].includes(e.group) && e.side===(d.type==="Receipt"?"dr":"cr"));
    if(!cur) return;
    const idx = opts.findIndex(o=>o===cur.ledger);
    const next = opts[(idx+1) % opts.length];
    const grp = next==="Cash" ? "Cash-in-Hand" : "Bank Accounts";
    setD(p=>({ ...p, modeAssumed:false, entries: p.entries.map(e=>e===cur||(e.ledger===cur.ledger&&e.side===cur.side)?{...e,ledger:next,group:grp}:e) }));
  }
  const setAmount = (val)=>{ const amount=parseInt(val.replace(/\D/g,"")||"0",10);
    setD(p=>{ const base={...p,amount};
      if(p.gstRate){ const r=gstSplitEntries(base,p.gstRate,p.gstIgst); return {...base,...r}; }
      return {...base,entries:p.entries.map(e=>({...e,amount}))}; }); };
  const setLedger = (i,name)=> setD(p=>({...p,entries:p.entries.map((e,idx)=>idx===i?{...e,ledger:name}:e)}));
  const dr=d.entries.find(e=>e.side==="dr"), cr=d.entries.find(e=>e.side==="cr");
  const natColor = d.natureLabel?.includes("Asset") ? "#2F6E8C" : d.natureLabel?.includes("Income")||d.natureLabel?.includes("Receipt")||d.natureLabel?.includes("Sales") ? INC : d.natureLabel?.includes("Purchase") ? GOLD : EXP;
  return (
    <div className="flex flex-col min-h-[600px]">
      <Header title="Confirm entry" right={<button onClick={onCancel} className="text-stone-400"><X size={20}/></button>} />
      <div className="px-4 flex-1 overflow-y-auto">
        {d.image ? (
          <div className="flex gap-3 mb-3 items-stretch">
            <img src={d.image} alt="scan" className="w-16 h-16 rounded-lg object-cover border shrink-0" style={{borderColor:HAIR}} />
            <div className="rounded-xl px-3 py-2.5 text-xs leading-snug flex-1 flex items-center" style={{background:SOFT,color:BURGUNDY_DK}}>Scanned {d.docLabel||"document"}{heard?` · ${heard}`:""}</div>
          </div>
        ) : (
          <div className="rounded-xl px-3 py-2.5 text-xs leading-snug mb-3" style={{background:SOFT,color:BURGUNDY_DK}}>Heard: <b>“{heard}”</b></div>
        )}
        <div className="flex items-center gap-2 mb-3">
          <span style={{background:BURGUNDY}} className="inline-flex items-center gap-1.5 text-white text-[11px] font-semibold px-3 py-1.5 rounded-full"><Sparkles size={13}/>{d.type}</span>
          {d.natureLabel && <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1.5 rounded-full" style={{background:"#fff",border:`1px solid ${natColor}`,color:natColor}}>{d.natureLabel.includes("Asset")?<Box size={12}/>:<Tag size={12}/>}{d.natureLabel}</span>}
          {d.modeAssumed && <button onClick={cycleMode} className="inline-flex items-center gap-1 text-[11px] font-semibold px-3 py-1.5 rounded-full" style={{background:"#FCF3E1",color:"#8a6516",border:"1px solid "+GOLD}}>Cash (assumed) · tap to change</button>}
        </div>
        <div className="border rounded-2xl overflow-hidden mb-3" style={{borderColor:HAIR}}>
          {d.entries.map((e,i)=> (<div key={i} className={"flex items-center gap-2.5 px-3 py-3 "+(i<d.entries.length-1?"border-b":"")} style={i<d.entries.length-1?{borderColor:HAIR}:{}}>
            <span style={e.side==="dr"?{background:"#FBEAE5",color:EXP}:{background:"#E7F1ED",color:INC}} className="w-7 h-7 rounded-lg grid place-items-center text-[11px] font-bold">{e.side==="dr"?"Dr":"Cr"}</span>
            <input value={e.ledger} onChange={ev=>setLedger(i,ev.target.value)} className="flex-1 text-[13px] font-semibold outline-none bg-transparent"/>
            <span className="font-mono font-semibold text-[13.5px]">{Math.round(e.amount).toLocaleString("en-IN")}</span>
          </div>))}
        </div>
        {gstEligible && (
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[11px] font-semibold text-stone-500">GST:</span>
            {[0,5,18].map(r=>(
              <button key={r} onClick={()=>applyGst(r, d.gstIgst)} className="px-3 py-1.5 rounded-full text-[12px] font-semibold border"
                style={(d.gstRate||0)===r?{background:BURGUNDY,color:"#fff",borderColor:BURGUNDY}:{borderColor:HAIR,color:"#57534e",background:"#fff"}}>{r===0?"None":r+"%"}</button>
            ))}
            {(d.gstRate||0)>0 && (
              <button onClick={()=>applyGst(d.gstRate, !d.gstIgst)} className="px-3 py-1.5 rounded-full text-[12px] font-semibold border"
                style={d.gstIgst?{background:GOLD,color:"#3a2a08",borderColor:GOLD}:{borderColor:HAIR,color:"#57534e",background:"#fff"}}>{d.gstIgst?"IGST":"CGST+SGST"}</button>
            )}
          </div>
        )}
        {alerts.length > 0 && (
          <div className="mb-3">
            {(showAllAlerts ? alerts : alerts.slice(0,2)).map(a => (
              <div key={a.code} className="flex items-start gap-2 rounded-xl px-3 py-2 mb-1.5 text-[11px] leading-snug" style={{background:a.sev==="red"?"#FBEAE5":a.sev==="amb"?"#FCF3E1":"#E8EEF2", color:a.sev==="red"?"#8a2318":a.sev==="amb"?"#7a5616":"#2F5468"}}>
                <span className="mt-0.5 w-1.5 h-1.5 rounded-full shrink-0" style={{background:a.sev==="red"?"#C0392B":a.sev==="amb"?"#B8860B":"#2F6E8C"}}/>
                <span>{a.text}{a.ref ? <span className="opacity-70"> — {a.ref}</span> : null}</span>
              </div>
            ))}
            {alerts.length > 2 && !showAllAlerts && (
              <button onClick={()=>setShowAllAlerts(true)} className="text-[11px] font-semibold" style={{color:BURGUNDY}}>+{alerts.length-2} more alert{alerts.length-2>1?"s":""}</button>
            )}
          </div>
        )}
        <Field label="Amount"><input value={d.amount} onChange={e=>setAmount(e.target.value)} inputMode="numeric" className="w-full outline-none bg-transparent font-mono text-lg font-semibold" style={{color:EXP}}/></Field>
        <Field label="Date"><input type="date" value={date} onChange={e=>setDate(e.target.value)} className="w-full outline-none bg-transparent text-[15px]"/></Field>
        <Field label="Narration"><input value={d.narration} onChange={e=>setD(p=>({...p,narration:e.target.value}))} className="w-full outline-none bg-transparent text-[15px]"/></Field>
      </div>
      <div className="p-4 flex gap-2.5">
        <button onClick={onCancel} className="flex-1 bg-stone-100 rounded-xl py-3.5 font-semibold text-sm">Cancel</button>
        <button onClick={()=>onSave({...d,date})} style={{background:BURGUNDY}} className="flex-[2] text-white rounded-xl py-3.5 font-semibold text-sm active:scale-[.99] transition">Save voucher</button>
      </div>
    </div>
  );
}
function Field({ label, children }) {
  return (<div className="mb-3"><label className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 block mb-1.5">{label}</label><div className="border rounded-xl px-3 py-3 bg-white" style={{borderColor:HAIR}}>{children}</div></div>);
}

/* ===== Ledgers ===== */
function Ledgers({ ledgers, balances, vouchers = [], onAlter, onDelete }) {
  const [q,setQ]=useState("");
  const [edit,setEdit]=useState(null); // {orig, name, group, opening}
  const used = (name)=> vouchers.some(v=>v.entries.some(e=>e.ledger===name));
  const grouped = useMemo(()=>{ const g={}; ledgers.filter(l=>l.name.toLowerCase().includes(q.toLowerCase())||l.group.toLowerCase().includes(q.toLowerCase())).forEach(l=>{(g[l.group]=g[l.group]||[]).push(l);}); return g; },[ledgers,q]);
  return (
    <div className="flex flex-col min-h-[600px] relative">
      <Header title="Ledgers" />
      <div className="px-4 flex-1 overflow-y-auto">
        <div className="bg-white border rounded-xl px-3 py-2.5 flex items-center gap-2 mb-3 text-sm text-stone-400" style={{borderColor:HAIR}}><Search size={16}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search ledgers / groups" className="flex-1 outline-none text-stone-800"/></div>
        {Object.entries(grouped).map(([g,ls])=>{ const nat=nature(g); const sub=ls.reduce((s,l)=>s+Math.abs(balances[l.name]||0),0);
          return (<div key={g} className="mb-3"><div className="flex justify-between text-[11px] font-semibold text-stone-500 mb-1.5"><span>{g}</span><span className="font-mono">{fmt(sub)}</span></div>
            {ls.map(l=>{ const b=balances[l.name]||0; const display=(nat==="liability"||nat==="income")?-b:b;
              return (<button key={l.name} onClick={()=>setEdit({orig:l.name,name:l.name,group:l.group,opening:String(l.opening||0)})} className="w-full text-left bg-white border rounded-xl px-3 py-3 mb-1.5 flex items-center justify-between active:scale-[.995] transition" style={{borderColor:HAIR}}><span className="text-[13px] font-semibold flex items-center gap-2">{l.name}<Pencil size={11} className="text-stone-300"/></span><Money n={display} kind={nat==="expense"?"e":"i"}/></button>);})}
          </div>);})}
      </div>
      {edit && (<>
        <div onClick={()=>setEdit(null)} className="absolute inset-0 z-20" style={{background:"rgba(36,19,24,.4)"}}/>
        <div className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl p-4 pb-6 z-30 max-h-[85%] overflow-y-auto" style={{boxShadow:"0 -20px 40px -20px rgba(0,0,0,.4)"}}>
          <div className="w-9 h-1 rounded-full mx-auto mb-3" style={{background:HAIR}}/>
          <h3 className="text-[16px] font-bold mb-3">Alter ledger</h3>
          <div className="mb-3"><label className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 block mb-1.5">Ledger name</label>
            <input value={edit.name} onChange={e=>setEdit(p=>({...p,name:e.target.value}))} className="w-full outline-none border rounded-xl px-3 py-3 text-[14px] font-semibold bg-white" style={{borderColor:HAIR}}/></div>
          <div className="mb-3"><label className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 block mb-1.5">Under group (Tally Prime)</label>
            <select value={edit.group} onChange={e=>setEdit(p=>({...p,group:e.target.value}))} className="w-full text-sm border rounded-xl px-3 py-3 bg-white" style={{borderColor:HAIR}}>{GROUP_NAMES.map(g=><option key={g}>{g}</option>)}</select></div>
          <div className="mb-3"><label className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 block mb-1.5">Opening balance (Dr +, Cr −)</label>
            <input value={edit.opening} onChange={e=>setEdit(p=>({...p,opening:e.target.value.replace(/[^\d.-]/g,"")}))} inputMode="numeric" className="w-full outline-none border rounded-xl px-3 py-3 font-mono text-[15px] bg-white" style={{borderColor:HAIR}}/></div>
          {edit.orig!==edit.name && <p className="text-[11px] text-stone-500 mb-3">Renaming updates all past vouchers using this ledger.</p>}
          <div className="flex gap-2.5">
            <button disabled={used(edit.orig)} onClick={()=>{onDelete(edit.orig);setEdit(null);}} className="flex-1 rounded-xl py-3.5 font-semibold text-sm disabled:opacity-40" style={{background:"#FBEAE5",color:EXP}}>{used(edit.orig)?"In use — can’t delete":"Delete"}</button>
            <button onClick={()=>{ if(edit.name.trim()){ onAlter(edit.orig,{name:edit.name.trim(),group:edit.group,opening:parseFloat(edit.opening)||0}); setEdit(null);} }} style={{background:BURGUNDY}} className="flex-[2] text-white rounded-xl py-3.5 font-semibold text-sm">Save</button>
          </div>
        </div>
      </>)}
    </div>
  );
}

/* ===== Day Book ===== */
function DayBook({ vouchers, onUpdate, onDelete, bizName }) {
  const [edit, setEdit] = useState(null);
  const [q, setQ] = useState(""); const [tf, setTf] = useState("All");
  const byDate = useMemo(()=>{ const g={};
    [...vouchers]
      .filter(v => tf==="All" || v.type===tf)
      .filter(v => { const hay=(v.narration+" "+(v.party||"")+" "+v.entries.map(e=>e.ledger).join(" ")+" "+(v.entries[0]?.amount||"")).toLowerCase(); return hay.includes(q.toLowerCase()); })
      .sort((a,b)=>b.date.localeCompare(a.date)).forEach(v=>{(g[v.date]=g[v.date]||[]).push(v);});
    return g; },[vouchers,q,tf]);
  const isExp = (t)=>["Payment","Purchase"].includes(t);
  return (
    <div className="flex flex-col min-h-[600px] relative">
      <Header title="Day Book" />
      <div className="px-4 flex-1 overflow-y-auto">
        <div className="bg-white border rounded-xl px-3 py-2.5 flex items-center gap-2 mb-2 text-sm text-stone-400" style={{borderColor:HAIR}}>
          <Search size={15}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search party, ledger, amount…" className="flex-1 outline-none text-stone-800"/>
        </div>
        <div className="flex gap-1.5 mb-3 overflow-x-auto pb-1">
          {["All","Payment","Receipt","Sales","Purchase","Contra","Journal"].map(t=>(
            <button key={t} onClick={()=>setTf(t)} className="px-3 py-1.5 rounded-full text-[11px] font-semibold whitespace-nowrap border" style={tf===t?{background:BURGUNDY,color:"#fff",borderColor:BURGUNDY}:{borderColor:HAIR,color:"#78716c",background:"#fff"}}>{t}</button>
          ))}
        </div>
        {Object.entries(byDate).map(([date,vs])=>(<div key={date} className="mb-3"><p className="text-[11px] font-semibold text-stone-500 mb-1.5">{new Date(date).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}</p>
          {vs.map(v=>{ const dr=v.entries.find(e=>e.side==="dr"),cr=v.entries.find(e=>e.side==="cr");
            return (<button key={v.id} onClick={()=>setEdit(JSON.parse(JSON.stringify(v)))} className="w-full text-left bg-white border rounded-xl px-3 py-3 mb-1.5 flex items-center gap-3 active:scale-[.995] transition" style={{borderColor:HAIR}}>
              <span style={isExp(v.type)?{background:"#FBEAE5"}:{background:"#E7F1ED"}} className="w-9 h-9 rounded-lg grid place-items-center text-base shrink-0">{isExp(v.type)?"⚡":"💰"}</span>
              <div className="flex-1 min-w-0"><b className="text-[13px]">{v.type}</b><div className="text-[11px] text-stone-500 truncate">{dr?.ledger} → {cr?.ledger}</div>{v.narration?<div className="text-[11px] text-stone-400 truncate">{v.narration}</div>:null}
                {v.alerts && v.alerts.length>0 && <div className="text-[10px] truncate mt-0.5 font-medium" style={{color:v.alerts[0].sev==="red"?"#C0392B":v.alerts[0].sev==="amb"?"#B8860B":"#2F6E8C"}}>⚠ {v.alerts[0].text}{v.alerts.length>1?`  (+${v.alerts.length-1})`:""}</div>}</div>
              <div className="flex flex-col items-end gap-1"><Money n={v.entries[0]?.amount||0} kind={isExp(v.type)?"e":"i"}/><Pencil size={12} className="text-stone-300"/></div></button>);})}
        </div>))}
        {vouchers.length===0 && <p className="text-stone-400 text-xs text-center py-8">No vouchers yet.</p>}
      </div>
      {edit && <VoucherEditSheet v={edit} bizName={bizName} onClose={()=>setEdit(null)} onSave={(nv)=>{onUpdate(nv);setEdit(null);}} onDelete={()=>{onDelete(edit.id);setEdit(null);}} />}
    </div>
  );
}

function VoucherEditSheet({ v, onClose, onSave, onDelete, bizName }) {
  const [d, setD] = useState(v);
  const [confirmDel, setConfirmDel] = useState(false);
  const isNew = !v.id;
  const twoLine = d.entries.length === 2;
  const setAmt = (val)=>{ const a=parseInt(String(val).replace(/\D/g,"")||"0",10); setD(p=>({...p,entries:p.entries.map(e=>({...e,amount:a}))})); };
  const setLgAt = (i,name)=> setD(p=>({...p,entries:p.entries.map((e,j)=>j===i?{...e,ledger:name}:e)}));
  function shareInvoice(){
    const money = d.entries.find(e=>e.side==="dr");
    const base = d.entries.find(e=>e.ledger==="Sales");
    const taxes = d.entries.filter(e=>/CGST|SGST|IGST/.test(e.ledger));
    const lines = [`*${bizName||"Karkoon"}* — Invoice`, `Date: ${d.date}`, d.party?`To: ${d.party}`:null,
      base?`Taxable value: ₹${Math.round(base.amount).toLocaleString("en-IN")}`:null,
      ...taxes.map(t=>`${t.ledger.replace(/^Output /,"")}: ₹${Math.round(t.amount).toLocaleString("en-IN")}`),
      `*Total: ₹${Math.round(money?.amount||0).toLocaleString("en-IN")}*`, d.narration?`(${d.narration})`:null].filter(Boolean);
    window.open("https://wa.me/?text="+encodeURIComponent(lines.join("\n")), "_blank");
  }
  return (<>
    <div onClick={onClose} className="absolute inset-0 z-20" style={{background:"rgba(36,19,24,.4)"}}/>
    <div className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl p-4 pb-6 z-30 max-h-[85%] overflow-y-auto" style={{boxShadow:"0 -20px 40px -20px rgba(0,0,0,.4)"}}>
      <div className="w-9 h-1 rounded-full mx-auto mb-3" style={{background:HAIR}}/>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[16px] font-bold">{isNew ? "New journal entry" : "Edit voucher"}</h3>
        {!isNew && d.type==="Sales" && <button onClick={shareInvoice} className="text-[11px] font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5" style={{background:"#E7F7EC",color:"#1B7A60"}}><MessageCircle size={13}/>Share invoice</button>}
      </div>
      <div className="flex gap-2 mb-3">
        <select value={d.type} onChange={e=>setD(p=>({...p,type:e.target.value}))} className="flex-1 text-sm border rounded-xl px-3 py-2.5 bg-white" style={{borderColor:HAIR}}>
          {["Payment","Receipt","Sales","Purchase","Contra","Journal"].map(t=><option key={t}>{t}</option>)}
        </select>
        <input type="date" value={d.date} onChange={e=>setD(p=>({...p,date:e.target.value}))} className="flex-1 text-sm border rounded-xl px-3 py-2.5 bg-white" style={{borderColor:HAIR}}/>
      </div>
      <div className="border rounded-2xl overflow-hidden mb-3" style={{borderColor:HAIR}}>
        {d.entries.map((e,i)=>(
          <div key={i} className={"flex items-center gap-2.5 px-3 py-3 "+(i<d.entries.length-1?"border-b":"")} style={i<d.entries.length-1?{borderColor:HAIR}:{}}>
            <span className="w-7 h-7 rounded-lg grid place-items-center text-[11px] font-bold" style={e.side==="dr"?{background:"#FBEAE5",color:EXP}:{background:"#E7F1ED",color:INC}}>{e.side==="dr"?"Dr":"Cr"}</span>
            <input value={e.ledger} onChange={ev=>setLgAt(i,ev.target.value)} placeholder={e.side==="dr"?"Debit ledger":"Credit ledger"} className="flex-1 text-[13px] font-semibold outline-none bg-transparent"/>
            <span className="font-mono font-semibold text-[13px]">{Math.round(e.amount).toLocaleString("en-IN")}</span>
          </div>
        ))}
      </div>
      {twoLine ? (
        <div className="mb-3"><label className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 block mb-1.5">Amount</label>
          <input value={d.entries[0]?.amount||0} onChange={e=>setAmt(e.target.value)} inputMode="numeric" className="w-full outline-none border rounded-xl px-3 py-3 font-mono text-lg font-semibold bg-white" style={{borderColor:HAIR,color:EXP}}/></div>
      ) : (
        <p className="text-[11px] text-stone-400 mb-3">GST voucher — line amounts are fixed; delete and re-enter to change the total.</p>
      )}
      <div className="mb-3"><label className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 block mb-1.5">Narration</label>
        <input value={d.narration||""} onChange={e=>setD(p=>({...p,narration:e.target.value}))} className="w-full outline-none border rounded-xl px-3 py-3 text-[14px] bg-white" style={{borderColor:HAIR}}/></div>
      {!isNew && d.log && d.log.length>0 && (
        <div className="mb-3 rounded-xl p-2.5" style={{background:PAPER}}>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-stone-400 mb-1">History</p>
          {d.log.slice(-3).map((l,i)=>(<p key={i} className="text-[10.5px] text-stone-500">{new Date(l.at).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})} · {l.action}{l.note?` — ${l.note}`:""}</p>))}
        </div>
      )}
      <div className="flex gap-2.5">
        {isNew
          ? <button onClick={onClose} className="flex-1 rounded-xl py-3.5 font-semibold text-sm bg-stone-100">Cancel</button>
          : !confirmDel
            ? <button onClick={()=>setConfirmDel(true)} className="flex-1 rounded-xl py-3.5 font-semibold text-sm" style={{background:"#FBEAE5",color:EXP}}>Delete</button>
            : <button onClick={onDelete} className="flex-1 rounded-xl py-3.5 font-semibold text-sm text-white" style={{background:EXP}}>Confirm delete?</button>}
        <button onClick={()=>{ if(d.entries.every(e=>e.ledger.trim()) && d.entries[0].amount>0) onSave(d); }} style={{background:BURGUNDY}} className="flex-[2] text-white rounded-xl py-3.5 font-semibold text-sm">{isNew?"Save journal":"Save changes"}</button>
      </div>
    </div>
  </>);
}

/* ===== Reports menu (mode-aware) ===== */
function Reports({ setReport, settings, cfg }) {
  const Item = ({ icon, title, sub, onClick, gold }) => (
    <button onClick={onClick} style={gold?{borderColor:GOLD,background:"#FCF3E1"}:{borderColor:HAIR}} className="w-full bg-white border rounded-xl p-3.5 flex items-center gap-3 mb-2.5 text-left">
      <span style={{background:gold?"#fff":TINT}} className="w-9 h-9 rounded-lg grid place-items-center">{icon}</span>
      <div className="flex-1"><b className="text-[13.5px] block">{title}</b><span className="text-[11px] text-stone-500">{sub}</span></div><ChevronRight size={18} className="text-stone-300"/>
    </button>
  );
  const complete = settings.mode === "complete";
  return (
    <div className="flex flex-col min-h-[600px]">
      <Header title="Reports" />
      <div className="px-4 flex-1 overflow-y-auto">
        {complete ? (<>
          <Item icon={<BarChart3 size={18} color={BURGUNDY}/>} title={cfg.plTitle} sub="Income, expenses & result" onClick={()=>setReport("pl")} />
          <Item icon={<Scale size={18} color={BURGUNDY}/>} title="Balance Sheet" sub="Assets & liabilities" onClick={()=>setReport("bs")} />
          <Item icon={<Layers size={18} color={BURGUNDY}/>} title="Trial Balance" sub="All ledger balances" onClick={()=>setReport("tb")} />
        </>) : (<>
          <Item icon={<ArrowLeftRight size={18} color={BURGUNDY}/>} title="Receipts & Payments" sub="Cash & bank in / out" onClick={()=>setReport("rnp")} />
        </>)}
        <Item icon={<Wallet size={18} color={BURGUNDY}/>} title="Outstanding" sub="Receivables & payables, ageing" onClick={()=>setReport("out")} />
        <Item icon={<BookOpen size={18} color={BURGUNDY}/>} title="Audit trail" sub="Who changed what, when" onClick={()=>setReport("audit")} />
        <Item icon={<Download size={18} color="#8a6516"/>} title="Export to Tally" sub="XML — masters & vouchers" gold onClick={()=>setReport("export")} />
      </div>
    </div>
  );
}

/* ===== Statement row ===== */
function StmtRow({ label, value, tot, np, sub }) {
  const style = np?{background:"#FCF3E1",color:"#7a5616",fontWeight:700}:tot?{background:SOFT,fontWeight:700}:{};
  return (<div style={style} className={"flex justify-between px-3 py-2 text-[12.5px] border-b "+(sub?"pl-6 text-stone-500":"")} ><span>{label}</span><span className="font-mono">{value}</span></div>);
}
function StmtHead({ left }) { return (<div style={{background:BURGUNDY}} className="text-white px-3 py-2.5 text-[11px] font-semibold flex justify-between"><span>{left}</span><span>₹</span></div>); }
function BackHeader({ title, onBack }) { return <Header title={title} right={<button onClick={onBack} className="text-stone-400"><X size={20}/></button>} />; }

function PeriodBar({ from, setFrom, to, setTo }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <div className="flex-1 bg-white border rounded-xl px-2.5 py-2 flex items-center gap-1.5" style={{borderColor:HAIR}}><Calendar size={13} className="text-stone-400"/><input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} className="flex-1 outline-none text-[12px] bg-transparent"/></div>
      <span className="text-stone-400 text-[11px]">to</span>
      <div className="flex-1 bg-white border rounded-xl px-2.5 py-2 flex items-center gap-1.5" style={{borderColor:HAIR}}><Calendar size={13} className="text-stone-400"/><input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)} className="flex-1 outline-none text-[12px] bg-transparent"/></div>
    </div>
  );
}

/* ===== Outstanding (receivables / payables) ===== */
function Outstanding({ ledgers, vouchers, balances, onBack }) {
  const rows = useMemo(()=>{
    const out = [];
    ledgers.filter(l=>["Sundry Debtors","Sundry Creditors"].includes(l.group)).forEach(l=>{
      const b = balances[l.name]||0; if (Math.round(b)===0) return;
      const last = vouchers.filter(v=>v.entries.some(e=>e.ledger===l.name)).map(v=>v.date).sort().pop();
      const days = last ? Math.floor((new Date(todayISO()) - new Date(last)) / 86400000) : null;
      out.push({ name:l.name, group:l.group, amt:Math.abs(b), recv: l.group==="Sundry Debtors", last, days });
    });
    return out.sort((a,b)=>b.amt-a.amt);
  },[ledgers,vouchers,balances]);
  const remind = (r)=> window.open("https://wa.me/?text="+encodeURIComponent(`Namaste ${r.name}, gentle reminder: ₹${r.amt.toLocaleString("en-IN")} is pending${r.last?` (last transaction ${r.last})`:""}. Kindly arrange payment. Thank you!`),"_blank");
  return (
    <div className="flex flex-col min-h-[600px]"><BackHeader title="Outstanding" onBack={onBack} />
      <div className="px-4 flex-1 overflow-y-auto">
        {["Receivables","Payables"].map(sec=>{
          const list = rows.filter(r=>sec==="Receivables"?r.recv:!r.recv);
          return (
            <div key={sec} className="mb-4">
              <div className="flex justify-between text-[11px] font-semibold text-stone-500 mb-1.5"><span>{sec}</span><span className="font-mono">{fmt(list.reduce((s,r)=>s+r.amt,0))}</span></div>
              {list.length===0 && <p className="text-stone-400 text-xs">Nothing pending.</p>}
              {list.map(r=>(
                <div key={r.name} className="bg-white border rounded-xl px-3 py-3 mb-1.5 flex items-center gap-3" style={{borderColor:HAIR}}>
                  <div className="flex-1 min-w-0"><b className="text-[13px] block truncate">{r.name}</b>
                    <span className="text-[11px]" style={{color: r.days>90?"#C0392B":r.days>45?"#B8860B":"#78716c"}}>{r.days!=null?`${r.days} days since last txn`:"no transactions"}{r.days>45 && !r.recv ? " · MSME 45-day check!" : ""}</span></div>
                  <Money n={r.amt} kind={r.recv?"i":"e"}/>
                  {r.recv && <button onClick={()=>remind(r)} className="w-8 h-8 rounded-lg grid place-items-center shrink-0" style={{background:"#E7F7EC"}}><MessageCircle size={15} color="#25D366"/></button>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ===== Audit trail ===== */
function AuditTrail({ vouchers, onBack }) {
  const events = useMemo(()=>{
    const ev = [];
    vouchers.forEach(v => (v.log||[]).forEach(l => ev.push({ at:l.at, action:l.action, note:l.note, ref:`${v.date} · ${v.type} · ₹${(v.entries[0]?.amount||0).toLocaleString("en-IN")}` })));
    return ev.sort((a,b)=>b.at.localeCompare(a.at));
  },[vouchers]);
  return (
    <div className="flex flex-col min-h-[600px]"><BackHeader title="Audit trail" onBack={onBack} />
      <div className="px-4 flex-1 overflow-y-auto">
        {events.length===0 && <p className="text-stone-400 text-xs text-center py-8">No activity yet.</p>}
        {events.map((e,i)=>(
          <div key={i} className="bg-white border rounded-xl px-3 py-2.5 mb-1.5" style={{borderColor:HAIR}}>
            <div className="flex justify-between"><b className="text-[12.5px] capitalize">{e.action}</b><span className="text-[10.5px] text-stone-400">{new Date(e.at).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"2-digit",minute:"2-digit"})}</span></div>
            <p className="text-[11px] text-stone-500">{e.ref}{e.note?` — ${e.note}`:""}</p>
          </div>
        ))}
        <p className="text-[10.5px] text-stone-400 text-center py-3">Deleted vouchers are recorded in the company audit log.</p>
      </div>
    </div>
  );
}

/* ===== P&L ===== */
function ProfitLoss({ ledgers, vouchers, cfg, onBack }) {
  const [from, setFrom] = useState(fyStartOf(todayISO()));
  const [to, setTo] = useState(todayISO());
  const { incomes, expenses, incomeTotal, expTotal, np } = useMemo(()=>{
    const flows = flowsBetween(vouchers, from, to);
    const incomes=[],expenses=[]; ledgers.forEach(l=>{ const nat=nature(l.group),b=flows[l.name]||0; if(nat==="income"&&Math.round(b)!==0)incomes.push([l.name,-b]); if(nat==="expense"&&Math.round(b)!==0)expenses.push([l.name,b]); });
    const incomeTotal=incomes.reduce((s,[,x])=>s+x,0), expTotal=expenses.reduce((s,[,x])=>s+x,0); return {incomes,expenses,incomeTotal,expTotal,np:incomeTotal-expTotal};
  },[ledgers,vouchers,from,to]);
  return (
    <div className="flex flex-col min-h-[600px]"><BackHeader title={cfg.plTitle} onBack={onBack} />
      <div className="px-4 flex-1 overflow-y-auto">
        <PeriodBar from={from} setFrom={setFrom} to={to} setTo={setTo} />
        <div className="bg-white border rounded-2xl overflow-hidden" style={{borderColor:HAIR}}>
          <StmtHead left="Particulars" />
          <StmtRow label="Income" value="" tot />{incomes.map(([n,x])=><StmtRow key={n} label={n} value={fmt(x)} sub/>)}<StmtRow label="Total Income" value={fmt(incomeTotal)} tot/>
          <StmtRow label="Expenses" value="" tot />{expenses.map(([n,x])=><StmtRow key={n} label={n} value={fmt(x)} sub/>)}<StmtRow label="Total Expenses" value={fmt(expTotal)} tot/>
          <StmtRow label={np>=0?"Surplus / Net Profit":"Deficit / Net Loss"} value={fmt(np)} np/>
        </div>
        <p className="text-[11px] text-stone-400 mt-3 text-center">Built live from your vouchers.</p>
      </div>
    </div>
  );
}

/* ===== Balance Sheet ===== */
function BalanceSheet({ ledgers, vouchers, onBack }) {
  const [asOn, setAsOn] = useState(todayISO());
  const { liab, asset, liabTotal, assetTotal, np } = useMemo(()=>{
    const bal = balancesAsOn(ledgers, vouchers, asOn);
    const liab=[],asset=[]; let inc=0,exp=0;
    ledgers.forEach(l=>{ const nat=nature(l.group),b=bal[l.name]||0; if(nat==="income")inc+=-b; else if(nat==="expense")exp+=b; else if(nat==="asset"){ if(Math.round(b)!==0)asset.push([l.name,b]); } else { if(Math.round(b)!==0)liab.push([l.name,-b]); } });
    const np=inc-exp, assetTotal=asset.reduce((s,[,x])=>s+x,0); let liabTotal=liab.reduce((s,[,x])=>s+x,0)+np; return {liab,asset,liabTotal,assetTotal,np};
  },[ledgers,vouchers,asOn]);
  return (
    <div className="flex flex-col min-h-[600px]"><BackHeader title="Balance Sheet" onBack={onBack} />
      <div className="px-4 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-semibold text-stone-500">As on</span>
          <div className="flex-1 bg-white border rounded-xl px-3 py-2 flex items-center gap-2" style={{borderColor:HAIR}}><Calendar size={14} className="text-stone-400"/><input type="date" value={asOn} onChange={e=>setAsOn(e.target.value)} className="flex-1 outline-none text-[13px] bg-transparent"/></div>
        </div>
        <div className="bg-white border rounded-2xl overflow-hidden mb-3" style={{borderColor:HAIR}}><StmtHead left="Liabilities" />{liab.map(([n,x])=><StmtRow key={n} label={n} value={fmt(x)}/>)}<StmtRow label={np>=0?"Add: Surplus":"Less: Deficit"} value={fmt(np)} sub/><StmtRow label="Total" value={fmt(liabTotal)} tot/></div>
        <div className="bg-white border rounded-2xl overflow-hidden" style={{borderColor:HAIR}}><StmtHead left="Assets" />{asset.map(([n,x])=><StmtRow key={n} label={n} value={fmt(x)}/>)}<StmtRow label="Total" value={fmt(assetTotal)} tot/></div>
        <p className="text-[11px] text-stone-400 mt-3 text-center">{Math.round(liabTotal)===Math.round(assetTotal)?"✓ Both sides tally.":"Difference in suspense."}</p>
      </div>
    </div>
  );
}

/* ===== Trial Balance ===== */
function TrialBalance({ ledgers, vouchers, onBack }) {
  const [asOn, setAsOn] = useState(todayISO());
  const balances = useMemo(()=>balancesAsOn(ledgers, vouchers, asOn), [ledgers, vouchers, asOn]);
  const rows = ledgers.map(l=>({ name:l.name, b:balances[l.name]||0 })).filter(r=>Math.round(r.b)!==0);
  const drTot = rows.filter(r=>r.b>0).reduce((s,r)=>s+r.b,0); const crTot = rows.filter(r=>r.b<0).reduce((s,r)=>s-r.b,0);
  return (
    <div className="flex flex-col min-h-[600px]"><BackHeader title="Trial Balance" onBack={onBack} />
      <div className="px-4 flex-1 overflow-y-auto">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[11px] font-semibold text-stone-500">As on</span>
          <div className="flex-1 bg-white border rounded-xl px-3 py-2 flex items-center gap-2" style={{borderColor:HAIR}}><Calendar size={14} className="text-stone-400"/><input type="date" value={asOn} onChange={e=>setAsOn(e.target.value)} className="flex-1 outline-none text-[13px] bg-transparent"/></div>
        </div>
        <div className="bg-white border rounded-2xl overflow-hidden" style={{borderColor:HAIR}}>
          <div style={{background:BURGUNDY}} className="text-white px-3 py-2.5 text-[11px] font-semibold flex"><span className="flex-1">Ledger</span><span className="w-16 text-right">Dr</span><span className="w-16 text-right">Cr</span></div>
          {rows.map(r=>(<div key={r.name} className="flex px-3 py-2 text-[12.5px] border-b" style={{borderColor:"#f1eae6"}}><span className="flex-1 truncate">{r.name}</span><span className="w-16 text-right font-mono">{r.b>0?fmt(r.b):""}</span><span className="w-16 text-right font-mono">{r.b<0?fmt(-r.b):""}</span></div>))}
          <div className="flex px-3 py-2 text-[12.5px] font-bold" style={{background:SOFT}}><span className="flex-1">Total</span><span className="w-16 text-right font-mono">{fmt(drTot)}</span><span className="w-16 text-right font-mono">{fmt(crTot)}</span></div>
        </div>
        <p className="text-[11px] text-stone-400 mt-3 text-center">{Math.round(drTot)===Math.round(crTot)?"✓ Dr = Cr":"Out of balance"}</p>
      </div>
    </div>
  );
}

/* ===== Receipts & Payments (for "I use other software" mode) ===== */
function ReceiptsPayments({ ledgers, vouchers, onBack }) {
  const cashBank = new Set(ledgers.filter(l=>["Cash-in-Hand","Bank Accounts","Bank OD A/c"].includes(l.group)).map(l=>l.name));
  const opening = ledgers.filter(l=>cashBank.has(l.name)).reduce((s,l)=>s+(l.opening||0),0);
  const receipts={}, payments={};
  vouchers.forEach(v=>{ const cb=v.entries.find(e=>cashBank.has(e.ledger)); const other=v.entries.find(e=>!cashBank.has(e.ledger)); if(!cb||!other)return;
    if(cb.side==="dr"){ receipts[other.ledger]=(receipts[other.ledger]||0)+cb.amount; } else { payments[other.ledger]=(payments[other.ledger]||0)+cb.amount; } });
  const rTot=Object.values(receipts).reduce((s,x)=>s+x,0), pTot=Object.values(payments).reduce((s,x)=>s+x,0);
  const closing = opening + rTot - pTot;
  return (
    <div className="flex flex-col min-h-[600px]"><BackHeader title="Receipts & Payments" onBack={onBack} />
      <div className="px-4 flex-1 overflow-y-auto">
        <div className="bg-white border rounded-2xl overflow-hidden mb-3" style={{borderColor:HAIR}}>
          <StmtHead left="Receipts" />
          <StmtRow label="Opening balance (cash + bank)" value={fmt(opening)} sub/>
          {Object.entries(receipts).map(([n,x])=><StmtRow key={n} label={n} value={fmt(x)}/>)}
          <StmtRow label="Total receipts" value={fmt(opening+rTot)} tot/>
        </div>
        <div className="bg-white border rounded-2xl overflow-hidden" style={{borderColor:HAIR}}>
          <StmtHead left="Payments" />
          {Object.entries(payments).map(([n,x])=><StmtRow key={n} label={n} value={fmt(x)}/>)}
          <StmtRow label="Closing balance (cash + bank)" value={fmt(closing)} sub/>
          <StmtRow label="Total payments" value={fmt(pTot+closing)} tot/>
        </div>
        <p className="text-[11px] text-stone-400 mt-3 text-center">Pure cash/bank movement — ideal when your main books live elsewhere.</p>
      </div>
    </div>
  );
}

/* ===== Export to Tally ===== */
function ExportTally({ ledgers, vouchers, importTallyMasters, onBack }) {
  const importRef = useRef(null);
  const [scope,setScope]=useState("both"); const [from,setFrom]=useState(FY_START); const [to,setTo]=useState(todayISO());
  const [sheet,setSheet]=useState(false); const [toast,setToast]=useState("");
  const inRange = vouchers.filter(v=>v.date>=from&&v.date<=to);
  const xml = useMemo(()=>buildTallyXML({ledgers,vouchers,scope,from,to}),[ledgers,vouchers,scope,from,to]);
  const filename = `Karkoon_Tally_${from}_to_${to}.xml`;
  const flash=(m)=>{setToast(m);setTimeout(()=>setToast(""),2600);};
  const blobFile=()=>{ const blob=new Blob([xml],{type:"application/xml"}); return {blob,file:new File([blob],filename,{type:"application/xml"})}; };
  function download(){ const {blob}=blobFile(); const url=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url); flash("XML downloaded"); }
  async function systemShare(){ const {file}=blobFile(); try{ if(navigator.canShare&&navigator.canShare({files:[file]})){ await navigator.share({files:[file],title:"Karkoon Tally Export",text:"Tally XML from Karkoon"}); return; } if(navigator.share){ await navigator.share({title:"Karkoon Tally Export",text:"Tally XML from Karkoon"});} else throw 0; }catch(e){ download(); flash("Share unavailable — downloaded instead"); } }
  function whatsapp(){ download(); window.open(`https://wa.me/?text=${encodeURIComponent(`Karkoon — Tally XML (${from} to ${to}). File downloaded — please attach "${filename}".`)}`,"_blank"); }
  function email(){ download(); window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent("Karkoon — Tally XML export")}&body=${encodeURIComponent(`Tally XML for ${from} to ${to}. File downloaded as "${filename}" — attach before sending.`)}`,"_blank"); }
  async function copy(){ try{ await navigator.clipboard.writeText(xml); flash("XML copied"); }catch(e){ flash("Copy failed"); } }
  function downloadCSV(){
    const rows = [["Date","Type","Voucher No","Dr Ledger","Cr Ledger","Amount","Party","Narration"]];
    let n=0; [...inRange].sort((a,b)=>a.date.localeCompare(b.date)).forEach(v=>{ n+=1;
      const dr=v.entries.filter(e=>e.side==="dr").map(e=>e.ledger).join(" + ");
      const cr=v.entries.filter(e=>e.side==="cr").map(e=>e.ledger).join(" + ");
      rows.push([v.date,v.type,"KK-"+String(n).padStart(4,"0"),dr,cr,v.entries[0]?.amount||0,v.party||"",(v.narration||"").replace(/"/g,"'")]);
    });
    const csv = rows.map(r=>r.map(c=>`"${c}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF"+csv],{type:"text/csv"}); const url=URL.createObjectURL(blob);
    const a=document.createElement("a"); a.href=url; a.download=`Karkoon_DayBook_${from}_to_${to}.csv`; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    flash("CSV downloaded — opens in Excel");
  }
  async function onImportFile(e){
    const f=e.target.files&&e.target.files[0]; e.target.value=""; if(!f)return;
    try{ const text=await f.text(); const r=importTallyMasters(text); flash(`Imported ${r.added} of ${r.total} ledgers from Tally`); }
    catch(err){ flash("Couldn't read that XML — export Masters from Tally and retry"); }
  }
  const ShareBtn = ({icon,label,onClick,bg}) => (<button onClick={()=>{setSheet(false);onClick();}} className="flex flex-col items-center gap-2 py-2"><span style={{background:bg}} className="w-14 h-14 rounded-2xl grid place-items-center">{icon}</span><span className="text-[11px] font-medium text-stone-600">{label}</span></button>);
  return (
    <div className="flex flex-col min-h-[600px] relative"><BackHeader title="Export to Tally" onBack={onBack} />
      <div className="px-4 flex-1 overflow-y-auto">
        <p className="text-stone-500 text-xs mb-3">Tally Prime–compatible XML.</p>
        <div className="flex rounded-xl p-1 mb-3" style={{background:"#efe7e3"}}>{[["both","Both"],["masters","Masters"],["vouchers","Vouchers"]].map(([id,lb])=>(<button key={id} onClick={()=>setScope(id)} style={scope===id?{background:"#fff",color:BURGUNDY,boxShadow:"0 1px 4px rgba(0,0,0,.08)"}:{color:"#8a7d78"}} className="flex-1 py-2 rounded-lg text-xs font-semibold">{lb}</button>))}</div>
        <label className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 block mb-1.5">Period — any range</label>
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 bg-white border rounded-xl px-3 py-2.5 flex items-center gap-2" style={{borderColor:HAIR}}><Calendar size={15} className="text-stone-400"/><input type="date" value={from} max={to} onChange={e=>setFrom(e.target.value)} className="flex-1 outline-none text-[13px] bg-transparent"/></div>
          <span className="text-stone-400 text-xs">to</span>
          <div className="flex-1 bg-white border rounded-xl px-3 py-2.5 flex items-center gap-2" style={{borderColor:HAIR}}><Calendar size={15} className="text-stone-400"/><input type="date" value={to} min={from} onChange={e=>setTo(e.target.value)} className="flex-1 outline-none text-[13px] bg-transparent"/></div>
        </div>
        <div className="flex gap-2 mb-3 flex-wrap">{[["This month",()=>{const d=new Date();setFrom(`${d.getFullYear()}-${pad(d.getMonth()+1)}-01`);setTo(todayISO());}],["This FY",()=>{setFrom(FY_START);setTo(todayISO());}],["All",()=>{setFrom("2000-01-01");setTo(todayISO());}]].map(([lb,fn])=>(<button key={lb} onClick={fn} className="text-[11px] font-semibold text-stone-600 rounded-lg px-3 py-1.5" style={{background:"#efe7e3"}}>{lb}</button>))}</div>
        <div className="rounded-xl px-3 py-2.5 text-[12px] font-medium mb-3" style={{background:TINT,color:BURGUNDY}}>In range: {inRange.length} voucher{inRange.length!==1?"s":""} · {ledgers.length} ledgers</div>
        <div className="rounded-xl p-3 font-mono text-[9.5px] leading-relaxed overflow-x-auto mb-3" style={{background:"#241318"}}><pre style={{color:"#E7B9C6"}} className="whitespace-pre-wrap">{xml.slice(0,340)}…</pre></div>
      </div>
      <div className="p-4 space-y-2">
        <button onClick={()=>setSheet(true)} style={{background:GOLD,color:"#3a2a08"}} className="w-full rounded-xl py-3.5 font-bold text-sm flex items-center justify-center gap-2 active:scale-[.99] transition"><Download size={18}/>Export Tally XML</button>
        <div className="flex gap-2">
          <button onClick={downloadCSV} className="flex-1 bg-white border rounded-xl py-3 font-semibold text-xs" style={{borderColor:HAIR,color:"#57534e"}}>⬇ Day Book CSV (Excel)</button>
          <button onClick={()=>importRef.current&&importRef.current.click()} className="flex-1 bg-white border rounded-xl py-3 font-semibold text-xs" style={{borderColor:HAIR,color:"#57534e"}}>⬆ Import Tally masters</button>
          <input ref={importRef} type="file" accept=".xml,text/xml" onChange={onImportFile} className="hidden" />
        </div>
      </div>
      {toast && <div className="absolute left-1/2 -translate-x-1/2 bottom-24 bg-stone-900 text-white text-xs px-4 py-2.5 rounded-full z-30">{toast}</div>}
      {sheet && (<>
        <div onClick={()=>setSheet(false)} style={{background:"rgba(36,19,24,.4)"}} className="absolute inset-0 z-20"/>
        <div className="absolute left-0 right-0 bottom-0 bg-white rounded-t-3xl p-4 pb-7 z-30" style={{boxShadow:"0 -20px 40px -20px rgba(0,0,0,.4)"}}>
          <div className="w-9 h-1 rounded-full mx-auto mb-3" style={{background:HAIR}}/>
          <h3 className="text-[16px] font-bold">Share Tally XML</h3><p className="text-stone-500 text-[11px] mb-3">{filename}</p>
          <div className="grid grid-cols-4 gap-1">
            <ShareBtn label="WhatsApp" onClick={whatsapp} bg="#E7F7EC" icon={<MessageCircle size={24} color="#25D366"/>} />
            <ShareBtn label="Email" onClick={email} bg="#FBEAE5" icon={<Mail size={24} color={EXP}/>} />
            <ShareBtn label="Share…" onClick={systemShare} bg="#E8EEF2" icon={<Share2 size={24} color="#3F6E8C"/>} />
            <ShareBtn label="Copy XML" onClick={copy} bg="#F3EEF7" icon={<Copy size={24} color="#7B5EA7"/>} />
          </div>
          <button onClick={()=>{setSheet(false);download();}} style={{background:BURGUNDY}} className="w-full text-white rounded-xl py-3.5 font-semibold text-sm mt-3 flex items-center justify-center gap-2"><Download size={18}/>Download to device</button>
          <p className="text-[10.5px] text-stone-400 text-center mt-3 leading-relaxed">“Share…” opens your phone's full share sheet (Gmail, WhatsApp, Drive…). For WhatsApp/Email the file is downloaded so you can attach it.</p>
        </div>
      </>)}
    </div>
  );
}

/* ===== Settings ===== */
function SettingsSheet({ settings, setSettings, onClose, onReset, companies = [], activeCo, onSwitchCo, onAddCo, onBackup, onRestore }) {
  const [wakeNote, setWakeNote] = useState(false);
  const [newCo, setNewCo] = useState("");
  const [pinDraft, setPinDraft] = useState("");
  const restoreRef = useRef(null);
  const [note, setNote] = useState("");
  const flash = (m)=>{ setNote(m); setTimeout(()=>setNote(""), 2500); };
  const set = (k,v)=>setSettings(s=>({...s,[k]:v}));
  async function onRestoreFile(e){
    const f=e.target.files&&e.target.files[0]; e.target.value=""; if(!f)return;
    try{ const obj=JSON.parse(await f.text()); onRestore(obj); flash("Backup restored"); }
    catch(err){ flash("Invalid backup file"); }
  }
  const Seg = ({ k, options }) => (
    <div className="flex rounded-xl p-1 mt-1.5" style={{background:"#efe7e3"}}>{options.map(([id,lb])=>(<button key={id} onClick={()=>set(k,id)} style={settings[k]===id?{background:"#fff",color:BURGUNDY,boxShadow:"0 1px 4px rgba(0,0,0,.08)"}:{color:"#8a7d78"}} className="flex-1 py-2 rounded-lg text-[12px] font-semibold">{lb}</button>))}</div>
  );
  return (
    <div className="absolute inset-0 z-40 flex flex-col" style={{background:PAPER}}>
      <Header title="Settings" right={<button onClick={onClose} className="text-stone-400"><X size={20}/></button>} />
      <div className="px-4 flex-1 overflow-y-auto pb-6">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-1">Company / books</p>
        <div className="bg-white border rounded-xl p-3 mb-1" style={{borderColor:HAIR}}>
          {companies.map(c=>(
            <button key={c.id} onClick={()=>onSwitchCo(c.id)} className="w-full flex items-center justify-between py-2 border-b last:border-b-0" style={{borderColor:"#f4efec"}}>
              <span className="text-[13px] font-semibold">{c.name}</span>
              <span className="w-4.5 h-4.5 w-[18px] h-[18px] rounded-full border-2" style={c.id===activeCo?{borderColor:BURGUNDY,background:BURGUNDY,boxShadow:"inset 0 0 0 3px #fff"}:{borderColor:HAIR}}/>
            </button>
          ))}
          <div className="flex gap-2 mt-2.5">
            <input value={newCo} onChange={e=>setNewCo(e.target.value)} placeholder="New company name" className="flex-1 outline-none text-sm border rounded-lg px-3 py-2" style={{borderColor:HAIR}}/>
            <button onClick={()=>{ if(newCo.trim()){ onAddCo(newCo.trim()); setNewCo(""); } }} style={{background:TINT,color:BURGUNDY}} className="rounded-lg px-3 font-semibold text-xs">+ Add</button>
          </div>
        </div>
        <p className="text-[10.5px] text-stone-400 mb-4 px-1">Each company keeps its own ledgers, vouchers & audit log.</p>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mb-1">Type of account</p>
        <Seg k="accountType" options={[["business","Business"],["profession","Profession"],["ngo","NGO"],["personal","Personal"]]} />
        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mt-5 mb-1">How you use it</p>
        <button onClick={()=>set("mode","complete")} className="w-full text-left border rounded-xl p-3 mt-1.5 bg-white flex items-start gap-2.5" style={settings.mode==="complete"?{borderColor:BURGUNDY}:{borderColor:HAIR}}>
          <Layers size={16} color={BURGUNDY} className="mt-0.5"/><div><b className="text-[13px]">Complete accounts here</b><div className="text-[11px] text-stone-500">Full double-entry · P&L, Balance Sheet, Trial Balance.</div></div>
        </button>
        <button onClick={()=>set("mode","rnp")} className="w-full text-left border rounded-xl p-3 mt-2 bg-white flex items-start gap-2.5" style={settings.mode==="rnp"?{borderColor:BURGUNDY}:{borderColor:HAIR}}>
          <ArrowLeftRight size={16} color={BURGUNDY} className="mt-0.5"/><div><b className="text-[13px]">Only receipts & payments</b><div className="text-[11px] text-stone-500">I use other software · just record cash/bank in & out, then export.</div></div>
        </button>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mt-5 mb-1">Tax profile</p>
        <div className="bg-white border rounded-xl p-3" style={{borderColor:HAIR}}>
          <div className="flex items-center justify-between">
            <div><b className="text-[13px]">GST registered</b><div className="text-[11px] text-stone-500">Enables RCM, ITC & e-way alerts</div></div>
            <button onClick={()=>set("gstRegistered",!settings.gstRegistered)} className="w-11 h-6 rounded-full relative transition" style={{background:settings.gstRegistered?BURGUNDY:"#d6cfca"}}>
              <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all" style={{left:settings.gstRegistered?"22px":"2px"}}/></button>
          </div>
          {settings.gstRegistered && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t" style={{borderColor:HAIR}}>
              <div><b className="text-[13px]">Composition scheme</b><div className="text-[11px] text-stone-500">Bill of Supply alerts on sales</div></div>
              <button onClick={()=>set("composition",!settings.composition)} className="w-11 h-6 rounded-full relative transition" style={{background:settings.composition?BURGUNDY:"#d6cfca"}}>
                <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all" style={{left:settings.composition?"22px":"2px"}}/></button>
            </div>
          )}
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mt-5 mb-1">Security</p>
        <div className="bg-white border rounded-xl p-3" style={{borderColor:HAIR}}>
          {settings.pin ? (
            <div className="flex items-center justify-between">
              <div><b className="text-[13px]">App lock is ON</b><div className="text-[11px] text-stone-500">PIN asked when Karkoon opens</div></div>
              <button onClick={()=>{ set("pin", null); flash("PIN removed"); }} className="text-xs font-semibold px-3 py-2 rounded-lg" style={{background:"#FBEAE5",color:EXP}}>Remove PIN</button>
            </div>
          ) : (
            <div>
              <b className="text-[13px]">Set an app PIN</b>
              <div className="flex gap-2 mt-2">
                <input type="password" inputMode="numeric" value={pinDraft} onChange={e=>setPinDraft(e.target.value.replace(/\D/g,"").slice(0,6))} placeholder="4–6 digits" className="flex-1 outline-none text-sm border rounded-lg px-3 py-2.5 font-mono" style={{borderColor:HAIR}}/>
                <button onClick={()=>{ if(pinDraft.length>=4){ set("pin", pinDraft); setPinDraft(""); flash("PIN set — locks on next open"); } }} style={{background:BURGUNDY}} className="text-white rounded-lg px-4 font-semibold text-xs">Set</button>
              </div>
            </div>
          )}
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mt-5 mb-1">Backup</p>
        <div className="bg-white border rounded-xl p-3 flex gap-2" style={{borderColor:HAIR}}>
          <button onClick={()=>{ onBackup(); flash("Backup downloaded"); }} className="flex-1 rounded-lg py-2.5 font-semibold text-xs" style={{background:TINT,color:BURGUNDY}}>⬇ Download backup</button>
          <button onClick={()=>restoreRef.current&&restoreRef.current.click()} className="flex-1 rounded-lg py-2.5 font-semibold text-xs border" style={{borderColor:HAIR,color:"#57534e"}}>⬆ Restore from file</button>
          <input ref={restoreRef} type="file" accept="application/json" onChange={onRestoreFile} className="hidden"/>
        </div>
        <p className="text-[10.5px] text-stone-400 mt-1 mb-4 px-1">Keep a backup safe — data currently lives only on this device.</p>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mt-1 mb-1">Voice</p>
        <div className="bg-white border rounded-xl p-3" style={{borderColor:HAIR}}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5"><Lock size={17} color={BURGUNDY}/><div><b className="text-[13px]">Wake &amp; record on lock screen</b><div className="text-[11px] text-stone-500">Say “Hey Karkoon” to record even when locked.</div></div></div>
            <button onClick={()=>{ set("wakeOnLock",!settings.wakeOnLock); setWakeNote(true); }} className="w-11 h-6 rounded-full relative transition" style={{background:settings.wakeOnLock?BURGUNDY:"#d6cfca"}}>
              <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all" style={{left:settings.wakeOnLock?"22px":"2px"}}/>
            </button>
          </div>
          {wakeNote && (<div className="mt-2.5 rounded-lg p-2.5 text-[11px] leading-relaxed" style={{background:"#FCF3E1",color:"#7a5616"}}>⚠️ Always-listening on a locked phone needs the installed Karkoon app and microphone permission. In this in-browser preview it can't run in the background — it's ready for the native build.</div>)}
        </div>
        <div className="bg-white border rounded-xl p-3 mt-2" style={{borderColor:HAIR}}>
          <div className="flex items-center justify-between">
            <div><b className="text-[13px]">Read entry back aloud</b><div className="text-[11px] text-stone-500">Speaks the voucher before you confirm</div></div>
            <button onClick={()=>set("readBack", settings.readBack===false?true:false)} className="w-11 h-6 rounded-full relative transition" style={{background:settings.readBack!==false?BURGUNDY:"#d6cfca"}}>
              <span className="absolute top-0.5 w-5 h-5 bg-white rounded-full transition-all" style={{left:settings.readBack!==false?"22px":"2px"}}/></button>
          </div>
        </div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mt-3 mb-1">Language</p>
        <Seg k="lang" options={[["en-IN","English"],["hi-IN","हिन्दी"],["kn-IN","ಕನ್ನಡ"]]} />

        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mt-5 mb-1">Document scan</p>
        <div className="bg-white border rounded-xl p-3" style={{borderColor:HAIR}}>
          <b className="text-[13px] flex items-center gap-2"><Camera size={15} color={BURGUNDY}/>Anthropic API key</b>
          <div className="text-[11px] text-stone-500 mt-0.5 mb-2">Needed for invoice/receipt scanning when the app runs outside Claude (e.g. GitHub Pages). Stored only on this device.</div>
          <input type="password" value={settings.scanKey||""} onChange={e=>set("scanKey",e.target.value.trim())} placeholder="sk-ant-…" className="w-full outline-none text-sm border rounded-lg px-3 py-2.5 font-mono" style={{borderColor:HAIR}} />
        </div>

        <p className="text-[11px] font-semibold uppercase tracking-wide text-stone-400 mt-5 mb-2">Brand</p>
        <div className="grid grid-cols-2 gap-2"><BrandSwatch variant="light"/><BrandSwatch variant="dark"/></div>

        <button onClick={()=>{onReset();onClose();}} className="w-full text-stone-400 text-xs flex items-center justify-center gap-1.5 py-4 mt-3"><RotateCcw size={13}/>Reset to sample data</button>
        {note && <div className="fixed left-1/2 -translate-x-1/2 bottom-8 bg-stone-900 text-white text-xs px-4 py-2.5 rounded-full z-50">{note}</div>}
      </div>
    </div>
  );
}
