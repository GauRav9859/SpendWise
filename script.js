/* =====================================================
   SpendWise — Daily Expense Tracker
   Vanilla JavaScript + Chart.js

   How this file is organised:
     1. Constants & app state
     2. Small helper functions (dates, money, safety)
     3. Storage (LocalStorage) + sample data
     4. Calculations (totals, filters, chart data)
     5. Rendering (stats, charts, lists, table)
     6. Forms (validation, add, edit)
     7. Modals, delete confirmation & toasts
     8. Navigation & event listeners
     9. App start-up
   ===================================================== */
'use strict';

/* =====================================================
   1. CONSTANTS & APP STATE
   ===================================================== */

const STORAGE_KEY = 'spendwise.transactions.v1';
const MAX_AMOUNT = 10000000; // ₹1 crore – a sensible upper limit

const EXPENSE_CATEGORIES = [
  'Food', 'Transportation', 'Shopping', 'Education',
  'Entertainment', 'Bills & Utilities', 'Healthcare', 'Other'
];
const INCOME_CATEGORIES = ['Salary', 'Freelance', 'Investments', 'Other Income'];
const PAYMENT_METHODS = ['Cash', 'UPI', 'Card'];

// Each category gets its own colour (used in the chart and the badges)
const CATEGORY_COLORS = {
  'Food': '#10b981',
  'Transportation': '#a3e635',
  'Shopping': '#2dd4bf',
  'Education': '#22d3ee',
  'Entertainment': '#a78bfa',
  'Bills & Utilities': '#fbbf24',
  'Healthcare': '#fb7185',
  'Other': '#94a3b8',
  'Salary': '#34d399',
  'Freelance': '#4ade80',
  'Investments': '#86efac',
  'Other Income': '#6ee7b7'
};

// All data the UI depends on lives in this one object
const state = {
  transactions: [],          // every saved transaction
  filters: { search: '', category: 'all', type: 'all', from: '', to: '' },
  doughnutRange: 'month',    // 'month' or 'all'
  editingId: null,           // id of the transaction in the edit modal
  confirmAction: null        // function to run when "Delete" is confirmed
};

let barChart = null;         // Chart.js instances (created on first render)
let doughnutChart = null;
let lastFocusedElement = null;
let storageWarningShown = false;

/* Shortcut for document.querySelector / querySelectorAll */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/* =====================================================
   2. HELPER FUNCTIONS
   ===================================================== */

/* Money: ₹1,23,456.00 (Indian digit grouping) */
const rupeeFull = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2
});
const rupeeShort = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2
});
const formatINR = (n) => rupeeFull.format(n);      // always 2 decimals (table)
const formatINRShort = (n) => rupeeShort.format(n); // hides ".00" (cards)

/* Avoid floating-point drift such as 0.1 + 0.2 = 0.30000000000000004 */
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/* Dates are stored as "YYYY-MM-DD" text. Using local time avoids timezone bugs. */
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
const todayStr = () => toDateStr(new Date());

function parseDate(str) {
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/* True only for real calendar dates, e.g. rejects 2026-02-31 */
function isValidDateStr(str) {
  if (typeof str !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  return toDateStr(parseDate(str)) === str;
}

function formatDisplayDate(str) {
  return parseDate(str).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/* Monday of the week that contains `date` */
function startOfWeek(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

/* Unique id for each transaction */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* Escape user text before putting it in innerHTML (prevents XSS) */
function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const categoryColor = (name) => CATEGORY_COLORS[name] || '#94a3b8';

/* Compact axis labels: 12500 -> ₹12.5k */
function formatCompact(n) {
  if (n >= 10000000) return '₹' + round2(n / 10000000) + 'Cr';
  if (n >= 100000) return '₹' + round2(n / 100000) + 'L';
  if (n >= 1000) return '₹' + round2(n / 1000) + 'k';
  return '₹' + round2(n);
}

/* =====================================================
   3. STORAGE (LocalStorage) & SAMPLE DATA
   ===================================================== */

/* A saved record must look right before we trust it. */
function isValidTransaction(t) {
  return t && typeof t === 'object'
    && typeof t.id === 'string'
    && (t.type === 'expense' || t.type === 'income')
    && typeof t.description === 'string'
    && Number.isFinite(t.amount) && t.amount > 0
    && typeof t.category === 'string'
    && typeof t.payment === 'string'
    && isValidDateStr(t.date);
}

/*
 * Reads transactions from LocalStorage.
 * Returns null when nothing has ever been saved (first visit),
 * otherwise an array (empty if the saved data was damaged).
 */
function loadTransactions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('Saved data is not a list');
    return parsed.filter(isValidTransaction);
  } catch (error) {
    console.warn('SpendWise: could not read saved data.', error);
    showToast('Saved data could not be read, starting fresh.', 'error');
    return [];
  }
}

/* Writes the current transactions to LocalStorage. */
function saveTransactions() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.transactions));
  } catch (error) {
    console.warn('SpendWise: could not save data.', error);
    if (!storageWarningShown) {
      storageWarningShown = true;
      showToast('Could not save to this browser. Changes may be lost on refresh.', 'error');
    }
  }
}

/* Demo transactions, with dates counted back from today so the charts always look alive. */
function buildSampleData() {
  // [type, description, amount, category, payment, daysAgo]
  const rows = [
    ['expense', 'Idli & filter coffee', 120, 'Food', 'Cash', 0],
    ['expense', 'Metro card recharge', 300, 'Transportation', 'UPI', 0],
    ['expense', 'Swiggy dinner', 480, 'Food', 'UPI', 1],
    ['expense', 'Movie tickets', 700, 'Entertainment', 'Card', 1],
    ['expense', 'BigBasket groceries', 1850, 'Food', 'UPI', 2],
    ['expense', 'Uber to airport', 640, 'Transportation', 'Card', 3],
    ['expense', 'Pharmacy – vitamins', 420, 'Healthcare', 'Cash', 4],
    ['expense', 'Amazon – headphones', 2499, 'Shopping', 'Card', 5],
    ['expense', 'Electricity bill', 1620, 'Bills & Utilities', 'UPI', 7],
    ['expense', 'Udemy Python course', 649, 'Education', 'Card', 9],
    ['expense', 'Lunch with friends', 950, 'Food', 'Cash', 10],
    ['income', 'Monthly salary', 60000, 'Salary', 'UPI', 12],
    ['expense', 'Netflix subscription', 649, 'Entertainment', 'Card', 14],
    ['expense', 'Petrol', 1500, 'Transportation', 'Cash', 16],
    ['expense', 'Broadband bill', 999, 'Bills & Utilities', 'UPI', 18],
    ['income', 'Freelance project', 12500, 'Freelance', 'UPI', 20],
    ['expense', 'Doctor consultation', 800, 'Healthcare', 'Cash', 22],
    ['expense', 'Myntra – shirts', 2199, 'Shopping', 'Card', 25],
    ['expense', 'Birthday gift', 1200, 'Other', 'Cash', 27],
    ['expense', 'Weekly groceries', 2100, 'Food', 'UPI', 33],
    ['expense', 'Mobile recharge', 599, 'Bills & Utilities', 'UPI', 36],
    ['expense', 'Exam prep books', 1350, 'Education', 'UPI', 40],
    ['income', 'Monthly salary', 60000, 'Salary', 'UPI', 42],
    ['expense', 'Dinner out', 1650, 'Food', 'Card', 44],
    ['expense', 'Cab rides', 780, 'Transportation', 'UPI', 48],
    ['expense', 'Electricity bill', 1480, 'Bills & Utilities', 'UPI', 52],
    ['expense', 'Concert tickets', 2500, 'Entertainment', 'Card', 55],
    ['expense', 'Running shoes', 3299, 'Shopping', 'Card', 60],
    ['expense', 'Dental check-up', 1500, 'Healthcare', 'Card', 65],
    ['income', 'Monthly salary', 60000, 'Salary', 'UPI', 72],
    ['expense', 'Monthly groceries', 2300, 'Food', 'UPI', 75],
    ['expense', 'Water bill', 350, 'Bills & Utilities', 'UPI', 80],
    ['expense', 'Online course', 1999, 'Education', 'Card', 88],
    ['expense', 'Weekend trip fuel', 2200, 'Transportation', 'Cash', 95],
    ['income', 'Monthly salary', 60000, 'Salary', 'UPI', 102],
    ['expense', 'Groceries', 2050, 'Food', 'UPI', 105],
    ['expense', 'Electricity bill', 1390, 'Bills & Utilities', 'UPI', 110],
    ['expense', 'Phone accessories', 1799, 'Shopping', 'Card', 120],
    ['income', 'Monthly salary', 60000, 'Salary', 'UPI', 132],
    ['expense', 'Family dinner', 1400, 'Food', 'Card', 135],
    ['expense', 'Medical tests', 2100, 'Healthcare', 'Card', 140]
  ];

  const now = Date.now();
  return rows.map(([type, description, amount, category, payment, daysAgo], index) => {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    return {
      id: uid(), type, description, amount, category, payment,
      date: toDateStr(date),
      createdAt: now - index // keeps the sample order stable
    };
  });
}

/* =====================================================
   4. CALCULATIONS
   ===================================================== */

const sumAmount = (list) => round2(list.reduce((total, t) => total + t.amount, 0));
const onlyExpenses = (list) => list.filter((t) => t.type === 'expense');
const onlyIncome = (list) => list.filter((t) => t.type === 'income');

/*
 * Works out the daily, weekly and monthly expense totals
 * (plus yesterday and last month, for the comparison badges).
 */
function getPeriodTotals() {
  const now = new Date();
  const today = todayStr();

  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = toDateStr(yesterdayDate);

  const weekStart = toDateStr(startOfWeek(now));
  const monthKey = today.slice(0, 7);
  const lastMonthKey = toDateStr(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7);

  const expenses = onlyExpenses(state.transactions);
  const total = (predicate) => sumAmount(expenses.filter(predicate));

  return {
    today: total((t) => t.date === today),
    yesterday: total((t) => t.date === yesterday),
    week: total((t) => t.date >= weekStart && t.date <= today),
    month: total((t) => t.date.slice(0, 7) === monthKey),
    lastMonth: total((t) => t.date.slice(0, 7) === lastMonthKey),
    monthKey
  };
}

/* Builds the text for "▲ 12% vs yesterday" style badges. */
function describeChange(current, previous, label) {
  if (previous === 0) {
    return { text: current === 0 ? `No spending ${label}` : `Nothing to compare with ${label}`, cls: '' };
  }
  const pct = ((current - previous) / previous) * 100;
  const rounded = Math.round(Math.abs(pct));
  if (rounded === 0) return { text: `Same as ${label}`, cls: '' };
  // For expenses, spending MORE is "bad" (red) and spending LESS is "good" (green)
  return pct > 0
    ? { text: `▲ ${rounded}% vs ${label}`, cls: 'up' }
    : { text: `▼ ${rounded}% vs ${label}`, cls: 'down' };
}

/* Expense totals for the last 6 calendar months (for the bar chart). */
function getMonthlySeries() {
  const now = new Date();
  const expenses = onlyExpenses(state.transactions);
  const labels = [];
  const data = [];

  for (let i = 5; i >= 0; i--) {
    const monthDate = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = toDateStr(monthDate).slice(0, 7);
    const label = monthDate.toLocaleDateString('en-IN', { month: 'short' });
    labels.push(monthDate.getMonth() === 0 ? `${label} ${monthDate.getFullYear()}` : label);
    data.push(sumAmount(expenses.filter((t) => t.date.slice(0, 7) === key)));
  }
  return { labels, data };
}

/* Expense totals per category, biggest first (for the doughnut chart). */
function getCategoryBreakdown(range) {
  const monthKey = todayStr().slice(0, 7);
  let expenses = onlyExpenses(state.transactions);
  if (range === 'month') expenses = expenses.filter((t) => t.date.slice(0, 7) === monthKey);

  const totals = {};
  expenses.forEach((t) => { totals[t.category] = (totals[t.category] || 0) + t.amount; });

  return Object.entries(totals)
    .map(([category, total]) => ({ category, total: round2(total), color: categoryColor(category) }))
    .sort((a, b) => b.total - a.total);
}

/* Applies search + category + type + date filters, newest first. */
function getFilteredTransactions() {
  const { search, category, type, from, to } = state.filters;
  const query = search.trim().toLowerCase();

  return state.transactions
    .filter((t) => {
      if (category !== 'all' && t.category !== category) return false;
      if (type !== 'all' && t.type !== type) return false;
      if (from && t.date < from) return false;
      if (to && t.date > to) return false;
      if (query) {
        const haystack = `${t.description} ${t.category} ${t.payment} ${t.amount} ${formatDisplayDate(t.date)}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort((a, b) => (b.date.localeCompare(a.date)) || ((b.createdAt || 0) - (a.createdAt || 0)));
}

/* =====================================================
   5. RENDERING
   ===================================================== */

/* Redraws everything. Called after any change to the data. */
function renderAll() {
  renderStats();
  renderSummary();
  renderBarChart();
  renderDoughnut();
  renderRecent();
  renderTable();
}

/* The four stat cards at the top of the dashboard. */
function renderStats() {
  const income = sumAmount(onlyIncome(state.transactions));
  const spent = sumAmount(onlyExpenses(state.transactions));
  const balance = round2(income - spent);
  const totals = getPeriodTotals();

  const balanceEl = $('#stat-balance');
  balanceEl.textContent = formatINRShort(balance);
  balanceEl.classList.toggle('negative', balance < 0);
  $('#stat-balance-sub').textContent = `Income ${formatINRShort(income)} · Spent ${formatINRShort(spent)}`;

  $('#stat-today').textContent = formatINRShort(totals.today);
  setChangeText($('#stat-today-sub'), describeChange(totals.today, totals.yesterday, 'yesterday'));

  $('#stat-month').textContent = formatINRShort(totals.month);
  setChangeText($('#stat-month-sub'), describeChange(totals.month, totals.lastMonth, 'last month'));

  const monthCount = state.transactions.filter((t) => t.date.slice(0, 7) === totals.monthKey).length;
  $('#stat-count').textContent = state.transactions.length.toLocaleString('en-IN');
  $('#stat-count-sub').textContent = `${monthCount} this month`;
}

function setChangeText(element, change) {
  element.textContent = '';
  const span = document.createElement('span');
  span.textContent = change.text;
  if (change.cls) span.className = change.cls;
  element.appendChild(span);
}

/* Daily / weekly / monthly summary tiles with small progress meters. */
function renderSummary() {
  const totals = getPeriodTotals();
  $('#sum-today').textContent = formatINRShort(totals.today);
  $('#sum-week').textContent = formatINRShort(totals.week);
  $('#sum-month').textContent = formatINRShort(totals.month);

  // Meters show each period relative to the biggest of the three
  const biggest = Math.max(totals.today, totals.week, totals.month, 1);
  $('#meter-today').style.width = `${(totals.today / biggest) * 100}%`;
  $('#meter-week').style.width = `${(totals.week / biggest) * 100}%`;
  $('#meter-month').style.width = `${(totals.month / biggest) * 100}%`;
}

/* Is the Chart.js library available? (It is loaded from a CDN.) */
const chartsAvailable = () => typeof window.Chart !== 'undefined';

function applyChartDefaults() {
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = '#7f9088';
}

/* Bar chart: expenses for the last 6 months. The current month is lime. */
function renderBarChart() {
  const canvas = $('#monthly-chart');
  if (!chartsAvailable()) {
    canvas.parentElement.hidden = true;
    $('#monthly-fallback').hidden = false;
    return;
  }

  const { labels, data } = getMonthlySeries();
  const colors = data.map((_, i) => (i === data.length - 1 ? '#a3e635' : 'rgba(16, 185, 129, 0.75)'));

  if (barChart) {
    barChart.data.labels = labels;
    barChart.data.datasets[0].data = data;
    barChart.data.datasets[0].backgroundColor = colors;
    barChart.update();
    return;
  }

  barChart = new Chart(canvas, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Expenses',
        data,
        backgroundColor: colors,
        borderRadius: 8,
        borderSkipped: false,
        maxBarThickness: 48
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#141d18',
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          padding: 12,
          displayColors: false,
          titleColor: '#e9f2ed',
          bodyColor: '#b6c4bc',
          callbacks: { label: (ctx) => `Spent: ${formatINR(ctx.parsed.y)}` }
        }
      },
      scales: {
        x: { grid: { display: false }, border: { display: false } },
        y: {
          beginAtZero: true,
          border: { display: false },
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { callback: (value) => formatCompact(value), maxTicksLimit: 6 }
        }
      }
    }
  });
}

/* Chart.js plugin that writes the total in the middle of the doughnut. */
const doughnutCenterText = {
  id: 'centerText',
  afterDraw(chart) {
    const area = chart.chartArea;
    if (!area) return;
    const { ctx } = chart;
    const x = (area.left + area.right) / 2;
    const y = (area.top + area.bottom) / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#7f9088';
    ctx.font = `500 12px ${Chart.defaults.font.family}`;
    ctx.fillText('Total spent', x, y - 12);
    ctx.fillStyle = '#e9f2ed';
    ctx.font = `700 20px ${Chart.defaults.font.family}`;
    ctx.fillText(formatCompact(chart.$centerTotal || 0), x, y + 11);
    ctx.restore();
  }
};

/* Doughnut chart + custom legend: spending by category. */
function renderDoughnut() {
  const items = getCategoryBreakdown(state.doughnutRange);
  const total = round2(items.reduce((sum, item) => sum + item.total, 0));

  $('#doughnut-subtitle').textContent = state.doughnutRange === 'month' ? 'This month' : 'All time';
  $('#doughnut-empty').hidden = total > 0;
  $('#doughnut-box').hidden = total === 0;

  // Legend (built with safe text nodes)
  const legend = $('#category-legend');
  legend.textContent = '';
  items.forEach((item) => {
    const li = document.createElement('li');
    const pct = total ? Math.round((item.total / total) * 100) : 0;
    li.innerHTML = `
      <span class="dot" style="background:${item.color}"></span>
      <span class="name">${escapeHTML(item.category)}</span>
      <span class="pct">${pct}%</span>
      <span class="val">${formatINRShort(item.total)}</span>`;
    legend.appendChild(li);
  });

  const canvas = $('#category-chart');
  if (!chartsAvailable()) {
    canvas.parentElement.hidden = true;
    $('#category-fallback').hidden = false;
    return;
  }
  if (total === 0) return; // nothing to draw; the empty message is showing

  const labels = items.map((i) => i.category);
  const values = items.map((i) => i.total);
  const colors = items.map((i) => i.color);

  if (doughnutChart) {
    doughnutChart.data.labels = labels;
    doughnutChart.data.datasets[0].data = values;
    doughnutChart.data.datasets[0].backgroundColor = colors;
    doughnutChart.$centerTotal = total;
    doughnutChart.update();
    return;
  }

  doughnutChart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{ data: values, backgroundColor: colors, borderColor: '#0f1612', borderWidth: 3, hoverOffset: 6 }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false }, // we draw our own legend
        tooltip: {
          backgroundColor: '#141d18',
          borderColor: 'rgba(255,255,255,0.12)',
          borderWidth: 1,
          padding: 12,
          titleColor: '#e9f2ed',
          bodyColor: '#b6c4bc',
          callbacks: { label: (ctx) => ` ${formatINR(ctx.parsed)}` }
        }
      }
    },
    plugins: [doughnutCenterText]
  });
  doughnutChart.$centerTotal = total;
  doughnutChart.update();
}

/* Round avatar with the category's first letter. */
function avatarHTML(t) {
  const color = t.type === 'income' ? '#34d399' : categoryColor(t.category);
  return `<span class="avatar" style="color:${color};background:${color}1f;border:1px solid ${color}40">${escapeHTML(t.category.charAt(0).toUpperCase())}</span>`;
}

const signedAmount = (t) => `${t.type === 'income' ? '+' : '−'}${formatINR(t.amount)}`;

/* "Recent Transactions" list on the dashboard (latest 5). */
function renderRecent() {
  const list = $('#recent-list');
  const recent = state.transactions.slice()
    .sort((a, b) => (b.date.localeCompare(a.date)) || ((b.createdAt || 0) - (a.createdAt || 0)))
    .slice(0, 5);

  $('#recent-empty').hidden = recent.length > 0;
  list.textContent = '';

  recent.forEach((t) => {
    const li = document.createElement('li');
    li.innerHTML = `
      ${avatarHTML(t)}
      <div class="recent-main">
        <p class="recent-title">${escapeHTML(t.description)}</p>
        <p class="recent-meta">${escapeHTML(t.category)} · ${formatDisplayDate(t.date)}</p>
      </div>
      <span class="amount ${t.type}">${signedAmount(t)}</span>`;
    list.appendChild(li);
  });
}

/* The full transactions table (respects the filters). */
function renderTable() {
  const rows = getFilteredTransactions();
  const total = state.transactions.length;
  const tbody = $('#table-body');
  tbody.textContent = '';

  // Summary line under the heading
  const summary = $('#table-summary');
  if (total === 0) {
    summary.textContent = 'No transactions recorded';
  } else {
    const spent = sumAmount(onlyExpenses(rows));
    const earned = sumAmount(onlyIncome(rows));
    summary.textContent = `Showing ${rows.length} of ${total} · Expenses ${formatINRShort(spent)} · Income ${formatINRShort(earned)}`;
  }

  // Friendly empty states
  const empty = $('#empty-state');
  const isFiltering = hasActiveFilters();
  empty.hidden = rows.length > 0;
  $('#table-wrap').hidden = rows.length === 0;

  if (rows.length === 0) {
    if (total === 0) {
      $('#empty-title').textContent = 'No transactions yet';
      $('#empty-text').textContent = 'Add your first expense to start tracking where your money goes.';
      $('#empty-primary').textContent = 'Add Expense';
      $('#empty-primary').dataset.mode = 'add';
      $('#empty-secondary').textContent = 'Load sample data';
      $('#empty-secondary').dataset.mode = 'sample';
    } else if (isFiltering) {
      $('#empty-title').textContent = 'No matching transactions';
      $('#empty-text').textContent = 'Try a different search term or adjust your filters.';
      $('#empty-primary').textContent = 'Clear filters';
      $('#empty-primary').dataset.mode = 'clear';
      $('#empty-secondary').textContent = 'Add Expense';
      $('#empty-secondary').dataset.mode = 'add';
    }
    return;
  }

  rows.forEach((t) => {
    const color = categoryColor(t.category);
    const tr = document.createElement('tr');
    tr.className = `row-${t.type}`;
    tr.innerHTML = `
      <td data-label="Description">
        <div class="cell-title" title="${escapeHTML(t.description)}">${escapeHTML(t.description)}</div>
        <div class="cell-sub">${t.type === 'income' ? 'Income' : 'Expense'}</div>
      </td>
      <td data-label="Category">
        <span class="badge" style="color:${color};background:${color}1a;border-color:${color}40">${escapeHTML(t.category)}</span>
      </td>
      <td data-label="Date" class="cell-date">${formatDisplayDate(t.date)}</td>
      <td data-label="Payment"><span class="pay">${escapeHTML(t.payment)}</span></td>
      <td data-label="Amount" class="num"><span class="amount ${t.type}">${signedAmount(t)}</span></td>
      <td data-label="Actions" class="actions-col">
        <div class="row-actions">
          <button class="icon-btn" type="button" data-action="edit" data-id="${escapeHTML(t.id)}" aria-label="Edit ${escapeHTML(t.description)}" title="Edit">
            <svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>
          </button>
          <button class="icon-btn danger" type="button" data-action="delete" data-id="${escapeHTML(t.id)}" aria-label="Delete ${escapeHTML(t.description)}" title="Delete">
            <svg viewBox="0 0 24 24" class="icon" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>
          </button>
        </div>
      </td>`;
    tbody.appendChild(tr);
  });
}

const hasActiveFilters = () => {
  const f = state.filters;
  return f.search.trim() !== '' || f.category !== 'all' || f.type !== 'all' || f.from !== '' || f.to !== '';
};

/* Fills a <select> with the right categories for "expense" or "income". */
function populateCategorySelect(select, type, selected) {
  const list = type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  select.textContent = '';
  list.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.appendChild(option);
  });
  if (selected && list.includes(selected)) select.value = selected;
}

/* Fills the category filter (expenses and income groups). */
function populateFilterCategories() {
  const select = $('#filter-category');
  select.textContent = '';
  const all = document.createElement('option');
  all.value = 'all';
  all.textContent = 'All categories';
  select.appendChild(all);

  [['Expense categories', EXPENSE_CATEGORIES], ['Income categories', INCOME_CATEGORIES]].forEach(([label, names]) => {
    const group = document.createElement('optgroup');
    group.label = label;
    names.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      group.appendChild(option);
    });
    select.appendChild(group);
  });
}

/* =====================================================
   6. FORMS: VALIDATION, ADD, EDIT
   ===================================================== */

/* Reads the values from either the add form or the edit form. */
function readForm(form) {
  const data = new FormData(form);
  const get = (name) => (data.get(name) ?? '').toString();
  return {
    type: get('type'),
    description: get('description').trim().replace(/\s+/g, ' '),
    amount: get('amount').trim(),
    category: get('category'),
    date: get('date'),
    payment: get('payment')
  };
}

/*
 * Checks every field. Returns an object like { amount: "message" }.
 * An empty object means the form is valid.
 */
function validateForm(values) {
  const errors = {};

  if (values.type !== 'expense' && values.type !== 'income') {
    errors.type = 'Please choose expense or income.';
  }

  if (values.description.length < 2) {
    errors.description = 'Enter a description (at least 2 characters).';
  } else if (values.description.length > 60) {
    errors.description = 'Description must be 60 characters or fewer.';
  }

  const amount = Number(values.amount);
  if (values.amount === '') {
    errors.amount = 'Enter an amount.';
  } else if (!Number.isFinite(amount)) {
    errors.amount = 'Amount must be a valid number.';
  } else if (amount <= 0) {
    errors.amount = 'Amount must be greater than ₹0.';
  } else if (amount > MAX_AMOUNT) {
    errors.amount = `Amount cannot exceed ${formatINRShort(MAX_AMOUNT)}.`;
  } else if (round2(amount) !== amount) {
    errors.amount = 'Use at most 2 decimal places.';
  }

  const allowedCategories = values.type === 'income' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
  if (!allowedCategories.includes(values.category)) {
    errors.category = 'Please choose a category.';
  }

  if (!PAYMENT_METHODS.includes(values.payment)) {
    errors.payment = 'Please choose a payment method.';
  }

  if (!values.date) {
    errors.date = 'Please select a date.';
  } else if (!isValidDateStr(values.date)) {
    errors.date = 'Please enter a valid date.';
  } else if (values.date > todayStr()) {
    errors.date = 'Date cannot be in the future.';
  }

  return errors;
}

/* Shows (or clears) the red error messages under each field. */
function showFormErrors(form, errors) {
  $$('.field', form).forEach((field) => {
    const input = $('input, select', field);
    const message = $('.error', field);
    const text = input && errors[input.name] ? errors[input.name] : '';
    if (message) message.textContent = text;
    field.classList.toggle('invalid', Boolean(text));
    if (input) input.setAttribute('aria-invalid', text ? 'true' : 'false');
  });

  // Move the cursor to the first field with a problem
  const firstBad = Object.keys(errors).find((name) => form.elements[name]);
  if (firstBad) {
    const target = form.elements[firstBad];
    if (target.focus) target.focus();
  }
}

const clearFormErrors = (form) => showFormErrors(form, {});

/* Builds a clean transaction object from validated form values. */
function buildTransaction(values, existing) {
  return {
    id: existing ? existing.id : uid(),
    type: values.type,
    description: values.description,
    amount: round2(Number(values.amount)),
    category: values.category,
    date: values.date,
    payment: values.payment,
    createdAt: existing ? existing.createdAt : Date.now()
  };
}

/* Resets the add form to its default state. */
function resetAddForm() {
  const form = $('#add-form');
  form.reset();
  populateCategorySelect(form.elements.category, 'expense');
  form.elements.date.value = todayStr();
  updateAddButtonLabel();
  clearFormErrors(form);
}

/* The submit button says "Add Expense" or "Add Income" depending on the toggle. */
function updateAddButtonLabel() {
  const type = $('#add-form').elements.type.value;
  $('#add-submit').textContent = type === 'income' ? 'Add Income' : 'Add Expense';
}

/* Handles the "Add Transaction" form. */
function handleAddSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = readForm(form);
  const errors = validateForm(values);

  if (Object.keys(errors).length > 0) {
    showFormErrors(form, errors);
    return;
  }

  const transaction = buildTransaction(values);
  state.transactions.push(transaction);
  saveTransactions();
  renderAll();
  resetAddForm();
  showToast(`${transaction.type === 'income' ? 'Income' : 'Expense'} of ${formatINR(transaction.amount)} added.`);
  $('#add-description').focus();
}

/* Opens the edit modal and fills it with the selected transaction. */
function openEditModal(id) {
  const transaction = state.transactions.find((t) => t.id === id);
  if (!transaction) return;

  state.editingId = id;
  const form = $('#edit-form');
  clearFormErrors(form);

  form.elements.type.value = transaction.type;
  populateCategorySelect(form.elements.category, transaction.type, transaction.category);
  form.elements.description.value = transaction.description;
  form.elements.amount.value = transaction.amount;
  form.elements.date.value = transaction.date;
  form.elements.payment.value = transaction.payment;

  openModal($('#edit-modal'), form.elements.description);
}

/* Handles the "Save Changes" button in the edit modal. */
function handleEditSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const values = readForm(form);
  const errors = validateForm(values);

  if (Object.keys(errors).length > 0) {
    showFormErrors(form, errors);
    return;
  }

  const index = state.transactions.findIndex((t) => t.id === state.editingId);
  if (index === -1) {
    closeModal($('#edit-modal'));
    showToast('That transaction no longer exists.', 'error');
    return;
  }

  state.transactions[index] = buildTransaction(values, state.transactions[index]);
  saveTransactions();
  renderAll();
  closeModal($('#edit-modal'));
  showToast('Transaction updated.');
}

/* When the Expense/Income toggle changes, swap the category list. */
function handleTypeChange(event) {
  if (event.target.name !== 'type') return;
  const form = event.currentTarget;
  populateCategorySelect(form.elements.category, form.elements.type.value);
  if (form.id === 'add-form') updateAddButtonLabel();
}

/* =====================================================
   7. MODALS, DELETE CONFIRMATION & TOASTS
   ===================================================== */

/* Opens a modal and moves keyboard focus into it. */
function openModal(modal, focusTarget) {
  lastFocusedElement = document.activeElement;
  modal.hidden = false;
  document.body.classList.add('modal-open');
  (focusTarget || $('button, input, select', modal)).focus();
}

/* Closes a modal and returns focus to where the user was. */
function closeModal(modal) {
  modal.hidden = true;
  if ($$('.modal').every((m) => m.hidden)) document.body.classList.remove('modal-open');
  if (lastFocusedElement && document.contains(lastFocusedElement)) lastFocusedElement.focus();
  if (modal.id === 'confirm-modal') state.confirmAction = null;
  if (modal.id === 'edit-modal') state.editingId = null;
}

/* Shows the "Are you sure?" dialog. `onConfirm` runs only if the user agrees. */
function askConfirmation({ title, message, confirmLabel, onConfirm }) {
  $('#confirm-title').textContent = title;
  $('#confirm-message').textContent = message;
  $('#confirm-ok').textContent = confirmLabel;
  state.confirmAction = onConfirm;
  openModal($('#confirm-modal'), $('#confirm-cancel'));
}

/* Asks before deleting a single transaction. */
function requestDelete(id) {
  const transaction = state.transactions.find((t) => t.id === id);
  if (!transaction) return;

  askConfirmation({
    title: 'Delete transaction?',
    message: `"${transaction.description}" (${formatINR(transaction.amount)}) will be permanently removed.`,
    confirmLabel: 'Delete',
    onConfirm: () => {
      state.transactions = state.transactions.filter((t) => t.id !== id);
      saveTransactions();
      renderAll();
      showToast('Transaction deleted.');
    }
  });
}

/* A small notification in the corner of the screen. */
function showToast(message, type = 'success') {
  const container = $('#toasts');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'error' : ''}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('leaving');
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

/* =====================================================
   8. NAVIGATION & EVENT LISTENERS
   ===================================================== */

const VIEW_INFO = {
  dashboard: { title: 'Dashboard', subtitle: null },
  transactions: { title: 'Transactions', subtitle: 'Search, filter, edit and manage every transaction' }
};

/* Switches between the Dashboard and Transactions screens. */
function setView(name) {
  if (!VIEW_INFO[name]) return;
  $$('.view').forEach((view) => view.classList.toggle('active', view.id === `view-${name}`));
  $$('[data-view]').forEach((btn) => {
    if (btn.classList.contains('link-btn')) return;
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  $('#page-title').textContent = VIEW_INFO[name].title;
  $('#page-subtitle').textContent = VIEW_INFO[name].subtitle || todayLong();
  window.scrollTo({ top: 0 });

  // Charts drawn while hidden need a nudge to fit their container
  if (name === 'dashboard') {
    if (barChart) barChart.resize();
    if (doughnutChart) doughnutChart.resize();
  }
}

const todayLong = () => new Date().toLocaleDateString('en-IN', {
  weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
});

/* "Add Expense" buttons: jump to the form and focus it. */
function goToAddForm() {
  setView('dashboard');
  const card = $('#add-card');
  card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => $('#add-description').focus({ preventScroll: true }), 350);
}

/* Reads the filter controls into state and redraws the table. */
function applyFiltersFromInputs() {
  state.filters.search = $('#search-input').value;
  state.filters.category = $('#filter-category').value;
  state.filters.type = $('#filter-type').value;
  state.filters.from = $('#filter-from').value;
  state.filters.to = $('#filter-to').value;

  // If the date range is backwards, swap it so results still make sense
  const { from, to } = state.filters;
  if (from && to && from > to) {
    state.filters.from = to;
    state.filters.to = from;
    $('#filter-from').value = to;
    $('#filter-to').value = from;
  }
  renderTable();
}

function clearFilters() {
  $('#search-input').value = '';
  $('#filter-category').value = 'all';
  $('#filter-type').value = 'all';
  $('#filter-from').value = '';
  $('#filter-to').value = '';
  applyFiltersFromInputs();
}

/* Replaces all data with the demo transactions. */
function loadSampleData() {
  state.transactions = buildSampleData();
  saveTransactions();
  renderAll();
}

function wireEvents() {
  // Navigation (sidebar, bottom bar, "View all")
  $$('[data-view]').forEach((btn) => btn.addEventListener('click', () => setView(btn.dataset.view)));
  $$('[data-action="go-add"]').forEach((btn) => btn.addEventListener('click', goToAddForm));

  // Forms
  const addForm = $('#add-form');
  const editForm = $('#edit-form');
  addForm.addEventListener('submit', handleAddSubmit);
  editForm.addEventListener('submit', handleEditSubmit);
  addForm.addEventListener('change', handleTypeChange);
  editForm.addEventListener('change', handleTypeChange);

  // Remove a field's error as soon as the user edits it
  [addForm, editForm].forEach((form) => {
    form.addEventListener('input', (event) => {
      const field = event.target.closest('.field');
      if (!field) return;
      field.classList.remove('invalid');
      const message = $('.error', field);
      if (message) message.textContent = '';
    });
  });

  // Filters (search waits 150ms after typing stops)
  let searchTimer;
  $('#search-input').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(applyFiltersFromInputs, 150);
  });
  ['#filter-category', '#filter-type', '#filter-from', '#filter-to'].forEach((selector) => {
    $(selector).addEventListener('change', applyFiltersFromInputs);
  });
  $('#clear-filters').addEventListener('click', clearFilters);

  // Edit / delete buttons inside the table (event delegation)
  $('#table-body').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'edit') openEditModal(button.dataset.id);
    if (button.dataset.action === 'delete') requestDelete(button.dataset.id);
  });

  // Empty-state buttons change meaning depending on the situation
  const emptyAction = (mode) => {
    if (mode === 'add') goToAddForm();
    if (mode === 'clear') clearFilters();
    if (mode === 'sample') {
      loadSampleData();
      showToast('Sample data loaded.');
    }
  };
  $('#empty-primary').addEventListener('click', (e) => emptyAction(e.currentTarget.dataset.mode));
  $('#empty-secondary').addEventListener('click', (e) => emptyAction(e.currentTarget.dataset.mode));

  // History actions
  $('#btn-clear-all').addEventListener('click', () => {
    if (state.transactions.length === 0) {
      showToast('There is nothing to clear.', 'error');
      return;
    }
    askConfirmation({
      title: 'Clear all transactions?',
      message: `This permanently deletes all ${state.transactions.length} transactions. This cannot be undone.`,
      confirmLabel: 'Clear all',
      onConfirm: () => {
        state.transactions = [];
        saveTransactions();
        renderAll();
        showToast('All transactions cleared.');
      }
    });
  });

  $('#btn-reset-demo').addEventListener('click', () => {
    askConfirmation({
      title: 'Reset to demo data?',
      message: 'Your current transactions will be replaced with the sample transactions.',
      confirmLabel: 'Reset',
      onConfirm: () => {
        loadSampleData();
        showToast('Demo data restored.');
      }
    });
  });

  // Doughnut period chips
  $$('.chip[data-range]').forEach((chip) => {
    chip.addEventListener('click', () => {
      state.doughnutRange = chip.dataset.range;
      $$('.chip[data-range]').forEach((c) => c.classList.toggle('active', c === chip));
      renderDoughnut();
    });
  });

  // Modals: close buttons, backdrop clicks and the Escape key
  $$('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => closeModal(el.closest('.modal')));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    const open = $$('.modal').find((m) => !m.hidden);
    if (open) closeModal(open);
  });

  // Confirm button runs the stored action
  $('#confirm-ok').addEventListener('click', () => {
    const action = state.confirmAction;
    closeModal($('#confirm-modal'));
    if (typeof action === 'function') action();
  });
}

/* =====================================================
   9. APP START-UP
   ===================================================== */

function init() {
  // Load saved data; on the very first visit, start with demo data
  const saved = loadTransactions();
  if (saved === null) {
    state.transactions = buildSampleData();
    saveTransactions();
  } else {
    state.transactions = saved;
  }

  if (chartsAvailable()) applyChartDefaults();

  // Prepare forms and filters
  populateFilterCategories();
  populateCategorySelect($('#add-form').elements.category, 'expense');
  populateCategorySelect($('#edit-form').elements.category, 'expense');
  $$('input[type="date"]').forEach((input) => { input.max = todayStr(); });
  $('#add-form').elements.date.value = todayStr();

  $('#page-subtitle').textContent = todayLong();

  wireEvents();
  renderAll();
}

document.addEventListener('DOMContentLoaded', init);