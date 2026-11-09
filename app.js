/* MMI Jar System
   Works in two modes:
   - Local mode: no Supabase keys in config.js. Data stays in this browser.
   - Cloud mode: Supabase keys set. Each user signs up and gets their own jars. */
(function () {
  "use strict";

  // ---------- constants ----------
  const DEFAULT_JARS = [
    { name: "Necessities", short: "NEC", pct: 55, color: "#4c7dff" },
    { name: "Financial Freedom", short: "FFA", pct: 10, color: "#a46bff" },
    { name: "Long-Term Savings", short: "LTS", pct: 10, color: "#3ecf8e" },
    { name: "Education", short: "EDU", pct: 10, color: "#e9a23b" },
    { name: "Play", short: "PLY", pct: 10, color: "#ff5fa2" },
    { name: "Giving", short: "GIV", pct: 5, color: "#ff6b6b" }
  ];
  const COLORS = ["#4c7dff", "#a46bff", "#3ecf8e", "#e9a23b", "#ff5fa2", "#ff6b6b", "#36c3e0", "#e9b949", "#9aa6c4"];
  const CATEGORIES = ["Food", "Bills", "Transport", "Shopping", "Health", "Family", "Business", "Fun", "Savings", "Other"];
  const METHODS = ["Cash", "GCash", "Maya", "Card", "Bank transfer"];
  const LOCAL_KEY = "mmi-jar-system-v1";

  // ---------- helpers ----------
  const $ = (s, r = document) => r.querySelector(s);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const peso = (n) => (n < 0 ? "−" : "") + "₱" + Math.round(Math.abs(n)).toLocaleString("en-PH");
  const pesoShort = (n) => {
    const a = Math.abs(n), s = n < 0 ? "−" : "";
    if (a >= 1e6) return s + "₱" + +(a / 1e6).toFixed(1) + "M";
    if (a >= 1e4) return s + "₱" + +(a / 1e3).toFixed(1) + "K";
    return peso(n);
  };
  const pad = (n) => String(n).padStart(2, "0");
  const ymd = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  const todayStr = () => ymd(new Date());
  const monthKey = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1);
  const parseDay = (s) => new Date(s + "T00:00:00");
  const monthLabel = (mk) => { const [y, m] = mk.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" }); };
  const shiftMonth = (mk, n) => { const [y, m] = mk.split("-").map(Number); return monthKey(new Date(y, m - 1 + n, 1)); };
  const daysInMonth = (mk) => { const [y, m] = mk.split("-").map(Number); return new Date(y, m, 0).getDate(); };
  const tint = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };

  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.hidden = false;
    clearTimeout(toast._h); toast._h = setTimeout(() => (t.hidden = true), 2200);
  }

  // ---------- storage backends ----------
  const cfg = window.MMI_CONFIG || {};
  const CLOUD = !!(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  let sb = null;
  if (CLOUD) sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);

  const Local = {
    read() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || null; } catch (e) { return null; } },
    write(d) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(d)); } catch (e) { toast("Couldn't save on this device"); } },
    async load() { const d = this.read(); return d || { profile: null, jars: [], txs: [] }; },
    async saveAll() { this.write({ profile: S.profile, jars: S.jars, txs: S.txs }); }
  };

  const Cloud = {
    async user() { const { data } = await sb.auth.getSession(); return data.session ? data.session.user : null; },
    async load() {
      const u = await this.user();
      const [p, j, t] = await Promise.all([
        sb.from("profiles").select("*").eq("id", u.id).maybeSingle(),
        sb.from("jars").select("*").order("sort"),
        sb.from("transactions").select("*").order("date", { ascending: false })
      ]);
      const err = p.error || j.error || t.error; if (err) throw err;
      return {
        profile: p.data ? { name: p.data.name, budget: Number(p.data.budget) } : null,
        jars: (j.data || []).map((x) => ({ ...x, pct: Number(x.pct) })),
        txs: (t.data || []).map((x) => ({ ...x, amount: Number(x.amount) }))
      };
    },
    async saveProfile(p) { const u = await this.user(); const r = await sb.from("profiles").upsert({ id: u.id, name: p.name, budget: p.budget }); if (r.error) throw r.error; },
    async saveJar(j) { const r = await sb.from("jars").upsert(strip(j, ["id", "name", "short", "pct", "color", "archived", "sort"])); if (r.error) throw r.error; },
    async saveJars(js) { const r = await sb.from("jars").upsert(js.map((j) => strip(j, ["id", "name", "short", "pct", "color", "archived", "sort"]))); if (r.error) throw r.error; },
    async saveTx(t) { const r = await sb.from("transactions").upsert(strip(t, ["id", "jar_id", "title", "amount", "date", "category", "method", "note"])); if (r.error) throw r.error; },
    async deleteTx(id) { const r = await sb.from("transactions").delete().eq("id", id); if (r.error) throw r.error; }
  };
  const strip = (o, keys) => { const r = {}; keys.forEach((k) => { if (o[k] !== undefined) r[k] = o[k]; }); return r; };

  // Persist helpers: one call per change, works for both modes.
  async function persist(kind, payload) {
    try {
      if (!CLOUD) return Local.saveAll();
      if (kind === "profile") await Cloud.saveProfile(S.profile);
      else if (kind === "jar") await Cloud.saveJar(payload);
      else if (kind === "jars") await Cloud.saveJars(payload);
      else if (kind === "tx") await Cloud.saveTx(payload);
      else if (kind === "deltx") await Cloud.deleteTx(payload);
    } catch (e) {
      console.error(e);
      toast("Couldn't sync. Check your connection.");
    }
  }

  // ---------- state ----------
  const S = {
    profile: null, jars: [], txs: [],
    histTab: "month", search: "", insightMonth: monthKey(new Date()), jarTab: "active"
  };
  const activeJars = () => S.jars.filter((j) => !j.archived).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  const jarById = (id) => S.jars.find((j) => j.id === id);

  function monthStats(mk) {
    const budget = S.profile.budget || 0;
    const txs = S.txs.filter((t) => t.date && t.date.slice(0, 7) === mk);
    const spent = txs.reduce((a, t) => a + t.amount, 0);
    const byJar = {};
    S.jars.forEach((j) => (byJar[j.id] = 0));
    txs.forEach((t) => (byJar[t.jar_id] = (byJar[t.jar_id] || 0) + t.amount));
    const byCat = {};
    txs.forEach((t) => (byCat[t.category || "Other"] = (byCat[t.category || "Other"] || 0) + t.amount));
    return { budget, txs, spent, left: budget - spent, byJar, byCat };
  }

  // ---------- icons ----------
  const I = {
    home: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3 2 11h3v9h5v-6h4v6h5v-9h3z"/></svg>',
    hist: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/></svg>',
    ins: '<svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="11" width="4" height="9" rx="1.5"/><rect x="10" y="5" width="4" height="15" rx="1.5"/><rect x="16" y="14" width="4" height="6" rx="1.5"/></svg>',
    jars: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 3h8M7 6h10a2 2 0 0 1 2 2v10a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3V8a2 2 0 0 1 2-2z"/></svg>',
    plus: '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
    edit: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    gear: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
    x: '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
    check: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/></svg>',
    warn: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.5"/></svg>'
  };
  const badge = (j, size) => j
    ? `<div class="badge" style="background:${tint(j.color, .16)};color:${j.color}${size ? ";width:" + size + "px;height:" + size + "px" : ""}">${esc(j.short)}</div>`
    : `<div class="badge" style="background:var(--surface-2);color:var(--muted)">?</div>`;

  // ---------- routing ----------
  const VIEWS = ["home", "history", "insights", "jars"];
  const view = () => { const h = location.hash.slice(1); return VIEWS.includes(h) ? h : "home"; };
  window.addEventListener("hashchange", () => { render(); window.scrollTo(0, 0); });

  // ---------- render ----------
  function render() {
    const root = $("#root");
    if (!S.profile) return renderOnboarding(root);
    const v = view();
    const body = { home: viewHome, history: viewHistory, insights: viewInsights, jars: viewJars }[v]();
    root.innerHTML = `<div class="app">${body}</div>${navHtml(v)}`;
    bind(v);
  }

  function navHtml(v) {
    const tab = (id, label, icon) => `<button class="tab ${v === id ? "on" : ""}" data-go="${id}" aria-current="${v === id}">${icon}${label}</button>`;
    return `<nav class="tabs"><div class="nav-inner">
      ${tab("home", "Home", I.home)}${tab("history", "History", I.hist)}
      <button class="fab" id="fab" aria-label="Add expense">${I.plus}</button>
      ${tab("insights", "Insights", I.ins)}${tab("jars", "Jars", I.jars)}
    </div></nav>`;
  }

  function budgetCard(slim) {
    const mk = monthKey(new Date());
    const st = monthStats(mk);
    const dim = daysInMonth(mk), daysLeft = dim - new Date().getDate() + 1;
    const pctLeft = st.budget ? Math.round((st.left / st.budget) * 100) : 0;
    const over = st.left < 0;
    const pill = over ? `<span class="pill over num">Over by ${peso(-st.left)}</span>` : `<span class="pill num">${pctLeft}% left</span>`;
    const bar = `<div class="bar"><i style="width:${Math.max(0, Math.min(100, pctLeft))}%;${over ? "background:var(--bad)" : ""}"></i></div>`;
    if (slim) return `<section class="budget slim">
      <div class="row-between"><span class="eyebrow">${monthLabel(mk)}</span>${pill}</div>
      <div class="big num">${peso(st.left)}</div>
      <div class="sub num">left of ${peso(st.budget)} · spent ${peso(st.spent)}</div>${bar}</section>`;
    return `<section class="budget">
      <div class="row-between"><span class="eyebrow">${monthLabel(mk)} budget</span>${pill}</div>
      <div class="big num">${peso(st.left)}</div>
      <div class="sub num">left of ${peso(st.budget)} monthly budget</div>${bar}
      <div class="stats">
        <div class="stat"><span>Spent</span><b class="num">${peso(st.spent)}</b></div>
        <div class="stat"><span>Days left</span><b class="num">${daysLeft}</b></div>
        <div class="stat"><span>Safe per day</span><b class="num">${peso(Math.max(0, st.left) / daysLeft)}</b></div>
      </div></section>`;
  }

  function jarState(alloc, spent) {
    const left = alloc - spent;
    if (left < 0) return ["Over by " + peso(-left), "var(--bad)"];
    if (alloc && spent / alloc > 0.8) return ["Running low", "var(--warn)"];
    return ["On track", "var(--good)"];
  }

  function viewHome() {
    const mk = monthKey(new Date()), st = monthStats(mk);
    const hour = new Date().getHours();
    const greet = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const first = (S.profile.name || "").split(" ")[0] || "there";
    const tiles = activeJars().map((j) => {
      const alloc = st.budget * j.pct / 100, spent = st.byJar[j.id] || 0, left = alloc - spent;
      const [label, col] = jarState(alloc, spent);
      const w = alloc ? Math.max(0, Math.min(100, (left / alloc) * 100)) : 0;
      return `<button class="jar" data-addjar="${j.id}">
        <span class="tag" style="color:${j.color}">${esc(j.short)}</span>
        <h3>${esc(j.name)}</h3>
        <div class="amt num">${pesoShort(left)}</div>
        <div class="of num">left of ${pesoShort(alloc)} · ${j.pct}%</div>
        <div class="mini"><i style="width:${w}%;background:${j.color}"></i></div>
        <span class="state" style="color:${col}">${label}</span></button>`;
    }).join("");
    const recent = [...S.txs].sort(sortTx).slice(0, 5);
    return `
      <div class="page-head">
        <div><h1>${greet}, ${esc(first)}</h1><p>Every peso has a job today.</p></div>
        <button class="icon-btn avatar" id="settingsBtn" aria-label="Settings">${esc(initials(S.profile.name))}</button>
      </div>
      ${budgetCard(false)}
      <div class="section-head"><h2>Your jars</h2><button class="link" data-go="jars">Manage jars</button></div>
      <div class="jars">${tiles || '<div class="empty" style="grid-column:1/-1">No active jars. Add one in Jars.</div>'}</div>
      <div class="section-head"><h2>Recent</h2>${recent.length ? '<button class="link" data-go="history">See all</button>' : ""}</div>
      ${recent.length ? `<div class="list">${recent.map(txRow).join("")}</div>`
        : '<div class="empty">Nothing logged yet. Tap the + button or a jar to add your first expense.</div>'}`;
  }

  const sortTx = (a, b) => (b.date || "").localeCompare(a.date || "") || (b.created_at || "").localeCompare(a.created_at || "");
  const initials = (n) => (n || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");

  function txRow(t, showDate = true) {
    const j = jarById(t.jar_id);
    const d = parseDay(t.date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const meta = [j ? j.name : "Deleted jar", t.category, showDate ? d : t.method].filter(Boolean).map(esc).join(" · ");
    return `<button class="tx" data-tx="${t.id}">${badge(j)}<div class="what"><b>${esc(t.title)}</b><span>${meta}</span></div><div class="amt num">${peso(t.amount)}</div></button>`;
  }

  function viewHistory() {
    const mk = monthKey(new Date());
    let txs = [...S.txs].sort(sortTx);
    if (S.histTab === "month") txs = txs.filter((t) => t.date.slice(0, 7) === mk);
    const q = S.search.trim().toLowerCase();
    if (q) txs = txs.filter((t) => [t.title, t.category, t.method, (jarById(t.jar_id) || {}).name].join(" ").toLowerCase().includes(q));
    const total = txs.reduce((a, t) => a + t.amount, 0);
    const groups = {};
    txs.forEach((t) => (groups[t.date] = groups[t.date] || []).push(t));
    const today = todayStr(), yest = ymd(new Date(Date.now() - 864e5));
    const html = Object.keys(groups).map((d) => {
      const label = d === today ? "Today" : d === yest ? "Yesterday" : parseDay(d).toLocaleDateString("en-US", { weekday: "long" });
      const sum = groups[d].reduce((a, t) => a + t.amount, 0);
      return `<div class="day-head"><b>${label}</b><span>${parseDay(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} · ${peso(sum)}</span></div>
        <div class="list">${groups[d].map((t) => txRow(t, false)).join("")}</div>`;
    }).join("");
    return `
      <div class="page-head"><div><h1>History</h1><p>${S.histTab === "month" ? monthLabel(mk) : "Everything you've logged"}</p></div></div>
      <div class="toolbar"><div class="seg">
        <button data-hist="month" class="${S.histTab === "month" ? "on" : ""}">This month</button>
        <button data-hist="all" class="${S.histTab === "all" ? "on" : ""}">All history</button>
      </div></div>
      <input id="search" type="search" placeholder="Search title, jar, category" value="${esc(S.search)}" autocomplete="off" style="margin-top:8px">
      <p class="count num">${txs.length} transaction${txs.length === 1 ? "" : "s"} · ${peso(total)}</p>
      <div id="histList">${html || `<div class="empty" style="margin-top:12px">${q ? "No matches for that search." : "No expenses here yet."}</div>`}</div>`;
  }

  function viewInsights() {
    const mk = S.insightMonth, st = monthStats(mk);
    const isNow = mk === monthKey(new Date());
    const dim = daysInMonth(mk), dayNo = isNow ? new Date().getDate() : dim;
    const pctUsed = st.budget ? (st.spent / st.budget) * 100 : 0;
    const over = st.spent > st.budget;
    const dailyBudget = st.budget / dim;
    // Bills are fixed costs, so they are left out of the daily pace.
    const flexSpent = st.txs.filter((t) => t.category !== "Bills").reduce((a, t) => a + t.amount, 0);
    const flexBudget = st.budget - st.txs.filter((t) => t.category === "Bills").reduce((a, t) => a + t.amount, 0);
    const avgDay = flexSpent / dayNo, flexDaily = flexBudget / dim;

    const jarRows = S.jars.filter((j) => !j.archived || st.byJar[j.id]).map((j) => {
      const alloc = st.budget * j.pct / 100, spent = st.byJar[j.id] || 0;
      const p = alloc ? (spent / alloc) * 100 : (spent ? 100 : 0);
      return `<div class="hbar"><span class="lbl">${esc(j.name)}</span>
        <div class="track"><i style="width:${Math.min(100, p)}%;background:${p > 100 ? "var(--bad)" : j.color}"></i></div>
        <span class="num ${p > 100 ? "over-txt" : ""}">${Math.round(p)}%</span></div>`;
    }).join("");
    const cats = Object.entries(st.byCat).sort((a, b) => b[1] - a[1]);
    const maxCat = cats.length ? cats[0][1] : 1;
    const catRows = cats.map(([c, v]) => `<div class="hbar"><span class="lbl">${esc(c)}</span>
      <div class="track"><i style="width:${(v / maxCat) * 100}%;background:var(--gold)"></i></div><span class="num">${pesoShort(v)}</span></div>`).join("");

    return `
      <div class="page-head"><div><h1>Insights</h1><p>Where your money went</p></div></div>
      <div class="row-between" style="margin-bottom:12px">
        <button class="icon-btn" data-im="-1" aria-label="Previous month">‹</button>
        <b style="font-family:var(--display);font-size:17px">${monthLabel(mk)}</b>
        <button class="icon-btn" data-im="1" aria-label="Next month" ${isNow ? "disabled style='opacity:.35'" : ""}>›</button>
      </div>
      <div class="card">
        <h3>Total spent</h3><p class="hint">${st.txs.length} transaction${st.txs.length === 1 ? "" : "s"} this month</p>
        <div class="big num" style="font-size:34px;margin:0">${peso(st.spent)}</div>
        <p class="num ${over ? "over-txt" : ""}" style="margin:4px 0 0;font-size:14px">${Math.round(pctUsed)}% of ${peso(st.budget)} budget${over ? " · over by " + peso(st.spent - st.budget) : ""}</p>
        <div class="bar" style="background:var(--surface-2)"><i style="width:${Math.min(100, pctUsed)}%;background:${over ? "var(--bad)" : "var(--gold)"}"></i></div>
        <div class="kpis">
          <div class="kpi"><span>Avg per day (no bills)</span><b class="num ${avgDay > flexDaily ? "over-txt" : "good-txt"}">${peso(avgDay)}</b></div>
          <div class="kpi"><span>Daily pace to stay on budget</span><b class="num">${peso(Math.max(0, flexDaily))}</b></div>
        </div>
      </div>
      <div class="card"><h3>By jar</h3><p class="hint">How much of each jar's share you've used</p>
        ${st.txs.length ? jarRows : '<p class="hint" style="margin:0">No spending this month.</p>'}</div>
      <div class="card"><h3>By category</h3><p class="hint">What you spent on</p>
        ${catRows || '<p class="hint" style="margin:0">No spending this month.</p>'}</div>`;
  }

  function viewJars() {
    const st = monthStats(monthKey(new Date()));
    const total = activeJars().reduce((a, j) => a + j.pct, 0);
    const ok = Math.abs(total - 100) < 0.01;
    const list = S.jars.filter((j) => (S.jarTab === "active" ? !j.archived : j.archived)).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
    const cards = list.map((j) => {
      const alloc = st.budget * j.pct / 100, spent = st.byJar[j.id] || 0, left = alloc - spent;
      const used = alloc ? (spent / alloc) * 100 : 0;
      return `<div class="jar-card">
        <div class="top">${badge(j)}<div class="name"><b>${esc(j.name)}</b><span>${j.pct}% of budget</span></div>
          <button class="icon-btn" data-editjar="${j.id}" aria-label="Edit ${esc(j.name)}">${I.edit}</button></div>
        <div class="money"><b class="num ${left < 0 ? "over-txt" : ""}">${peso(left)} left</b><span class="of num">of ${peso(alloc)}</span></div>
        <div class="mini" style="height:7px"><i style="width:${Math.min(100, used)}%;background:${used > 100 ? "var(--bad)" : j.color}"></i></div>
        <div class="row-between of num"><span>${peso(spent)} spent</span><span class="${used > 100 ? "over-txt" : ""}">${Math.round(used)}% used</span></div>
      </div>`;
    }).join("");
    return `
      <div class="page-head"><div><h1>Your jars</h1><p>Set how your budget gets split</p></div>
        <button class="icon-btn" id="settingsBtn" aria-label="Budget settings">${I.gear}</button></div>
      ${budgetCard(true)}
      <div class="alloc-note ${ok ? "ok" : "bad"}">${ok ? I.check : I.warn}<span class="num">${ok ? "All 100% assigned" : `${total}% assigned. Adjust your jars so they add up to 100%.`}</span></div>
      <div class="row-between" style="margin:14px 0 12px">
        <div class="seg"><button data-jt="active" class="${S.jarTab === "active" ? "on" : ""}">Active</button><button data-jt="archived" class="${S.jarTab === "archived" ? "on" : ""}">Archived</button></div>
        <button class="btn small" id="addJar">+ Add jar</button>
      </div>
      <div class="jar-list">${cards || `<div class="empty">${S.jarTab === "active" ? "No active jars yet." : "No archived jars."}</div>`}</div>`;
  }

  // ---------- events ----------
  function bind(v) {
    document.querySelectorAll("[data-go]").forEach((b) => b.onclick = () => { location.hash = b.dataset.go; });
    $("#fab").onclick = () => openTxSheet();
    const sBtn = $("#settingsBtn"); if (sBtn) sBtn.onclick = openSettings;
    document.querySelectorAll("[data-addjar]").forEach((b) => b.onclick = () => openTxSheet(null, b.dataset.addjar));
    document.querySelectorAll("[data-tx]").forEach((b) => b.onclick = () => openTxSheet(S.txs.find((t) => t.id === b.dataset.tx)));
    if (v === "history") {
      document.querySelectorAll("[data-hist]").forEach((b) => b.onclick = () => { S.histTab = b.dataset.hist; render(); });
      const s = $("#search");
      s.oninput = () => { S.search = s.value; const pos = s.selectionStart; render(); const n = $("#search"); n.focus(); n.setSelectionRange(pos, pos); };
    }
    if (v === "insights") document.querySelectorAll("[data-im]").forEach((b) => b.onclick = () => {
      const next = shiftMonth(S.insightMonth, +b.dataset.im);
      if (next > monthKey(new Date())) return;
      S.insightMonth = next; render();
    });
    if (v === "jars") {
      document.querySelectorAll("[data-jt]").forEach((b) => b.onclick = () => { S.jarTab = b.dataset.jt; render(); });
      document.querySelectorAll("[data-editjar]").forEach((b) => b.onclick = () => openJarSheet(jarById(b.dataset.editjar)));
      $("#addJar").onclick = () => openJarSheet(null);
    }
  }

  // ---------- sheets ----------
  function sheet(html, onMount) {
    const bg = document.createElement("div");
    bg.className = "sheet-bg";
    bg.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(bg);
    document.body.style.overflow = "hidden";
    const close = () => { bg.remove(); document.body.style.overflow = ""; };
    bg.addEventListener("click", (e) => { if (e.target === bg) close(); });
    bg.querySelectorAll("[data-close]").forEach((b) => b.onclick = close);
    const onKey = (e) => { if (e.key === "Escape") { close(); document.removeEventListener("keydown", onKey); } };
    document.addEventListener("keydown", onKey);
    onMount(bg, close);
  }

  function openTxSheet(tx, jarId) {
    const jars = activeJars();
    if (!jars.length) { toast("Add a jar first"); location.hash = "jars"; return; }
    const editing = !!tx;
    let pick = tx ? tx.jar_id : jarId || jars[0].id;
    const pickable = editing && !jars.find((j) => j.id === pick) && jarById(pick) ? [...jars, jarById(pick)] : jars;
    const opts = (arr, val) => arr.map((o) => `<option ${o === val ? "selected" : ""}>${esc(o)}</option>`).join("");
    sheet(`
      <div class="sheet-head"><h3>${editing ? "Edit expense" : "Add expense"}</h3><button class="close" data-close aria-label="Close">${I.x}</button></div>
      <form id="txForm" novalidate>
        <div class="amount-wrap"><span>₱</span><input id="amt" inputmode="decimal" placeholder="0" value="${editing ? tx.amount : ""}" aria-label="Amount" autocomplete="off"></div>
        <div style="display:flex;flex-direction:column;gap:14px;margin-top:10px">
          <label class="f">Charge jar</label>
          <div class="jar-pick" id="jarPick" style="margin-top:-8px"></div>
          <label class="f">Title<input id="title" placeholder="e.g. Groceries, Globe internet" value="${editing ? esc(tx.title) : ""}" autocomplete="off"></label>
          <div class="grid2">
            <label class="f">Date<input id="date" type="date" value="${editing ? tx.date : todayStr()}"></label>
            <label class="f">Paid with<select id="method">${opts(METHODS, editing ? tx.method : "Cash")}</select></label>
          </div>
          <label class="f">Category<select id="cat">${opts(CATEGORIES, editing ? tx.category : "Food")}</select></label>
          <p class="err" id="err"></p>
        </div>
        <div class="sticky-save">
          ${editing ? '<button type="button" class="btn danger" id="del">Delete</button>' : ""}
          <button type="submit" class="btn">${editing ? "Save changes" : "Save expense"}</button>
        </div>
      </form>`, (bg, close) => {
      const drawPick = () => {
        $("#jarPick", bg).innerHTML = pickable.map((j) => `<button type="button" data-p="${j.id}" class="${j.id === pick ? "on" : ""}">${badge(j)}<span>${esc(j.name)}</span></button>`).join("");
        bg.querySelectorAll("[data-p]").forEach((b) => b.onclick = () => { pick = b.dataset.p; drawPick(); });
      };
      drawPick();
      if (!editing) setTimeout(() => $("#amt", bg).focus(), 60);
      let delArmed = false;
      if (editing) $("#del", bg).onclick = (e) => {
        if (!delArmed) { delArmed = true; e.target.textContent = "Tap again to delete"; return; }
        S.txs = S.txs.filter((t) => t.id !== tx.id); persist("deltx", tx.id); close(); render(); toast("Expense deleted");
      };
      $("#txForm", bg).onsubmit = (e) => {
        e.preventDefault();
        const amount = parseFloat(String($("#amt", bg).value).replace(/[,₱\s]/g, ""));
        if (!amount || amount <= 0) { $("#err", bg).textContent = "Enter an amount above zero."; $("#amt", bg).focus(); return; }
        const date = $("#date", bg).value || todayStr();
        const cat = $("#cat", bg).value;
        const title = $("#title", bg).value.trim() || cat;
        const rec = { id: editing ? tx.id : uid(), jar_id: pick, title, amount: Math.round(amount * 100) / 100, date, category: cat, method: $("#method", bg).value, created_at: editing ? tx.created_at : new Date().toISOString() };
        if (editing) S.txs = S.txs.map((t) => (t.id === rec.id ? rec : t)); else S.txs.push(rec);
        persist("tx", rec); close(); render();
        const j = jarById(pick), st = monthStats(monthKey(new Date()));
        const left = st.budget * j.pct / 100 - (st.byJar[j.id] || 0);
        toast(editing ? "Saved" : left < 0 ? `${j.name} is over by ${peso(-left)}` : `${j.name}: ${peso(left)} left`);
      };
    });
  }

  function openJarSheet(jar) {
    const editing = !!jar;
    let color = jar ? jar.color : COLORS.find((c) => !S.jars.some((j) => j.color === c)) || COLORS[0];
    const otherPct = activeJars().filter((j) => !jar || j.id !== jar.id).reduce((a, j) => a + j.pct, 0);
    sheet(`
      <div class="sheet-head"><h3>${editing ? "Edit jar" : "New jar"}</h3><button class="close" data-close aria-label="Close">${I.x}</button></div>
      <form id="jarForm" novalidate style="display:flex;flex-direction:column;gap:14px">
        <label class="f">Jar name<input id="jn" value="${editing ? esc(jar.name) : ""}" placeholder="e.g. Emergency Fund" autocomplete="off"></label>
        <div class="grid2">
          <label class="f">Short name<input id="js" maxlength="4" value="${editing ? esc(jar.short) : ""}" placeholder="EMF" autocomplete="off"></label>
          <label class="f">Share of budget (%)<input id="jp" inputmode="decimal" value="${editing ? jar.pct : Math.max(0, 100 - otherPct)}" autocomplete="off"></label>
        </div>
        <p class="of num" id="pctHint" style="margin:-6px 0 0"></p>
        <label class="f">Color</label>
        <div class="swatches" id="sw" style="margin-top:-8px"></div>
        <p class="err" id="err"></p>
        <div class="sticky-save">
          ${editing ? `<button type="button" class="btn ghost" id="arch">${jar.archived ? "Restore" : "Archive"}</button>` : ""}
          <button type="submit" class="btn">${editing ? "Save jar" : "Add jar"}</button>
        </div>
      </form>`, (bg, close) => {
      const drawSw = () => {
        $("#sw", bg).innerHTML = COLORS.map((c) => `<button type="button" aria-label="Color ${c}" data-c="${c}" class="${c === color ? "on" : ""}" style="background:${c}"></button>`).join("");
        bg.querySelectorAll("[data-c]").forEach((b) => b.onclick = () => { color = b.dataset.c; drawSw(); });
      };
      const hint = () => {
        const p = parseFloat($("#jp", bg).value) || 0, tot = otherPct + (jar && jar.archived ? 0 : p);
        $("#pctHint", bg).textContent = `Total with this jar: ${+tot.toFixed(2)}%` + (Math.abs(tot - 100) < .01 ? " ✓" : tot > 100 ? " (over 100%)" : "");
      };
      drawSw(); hint(); $("#jp", bg).oninput = hint;
      if (!editing) setTimeout(() => $("#jn", bg).focus(), 60);
      if (editing) $("#arch", bg).onclick = () => {
        jar.archived = !jar.archived; persist("jar", jar); close(); render();
        toast(jar.archived ? `${jar.name} archived. Its % is freed up.` : `${jar.name} restored`);
      };
      $("#jarForm", bg).onsubmit = (e) => {
        e.preventDefault();
        const name = $("#jn", bg).value.trim();
        const short = ($("#js", bg).value.trim() || name.replace(/[^A-Za-z]/g, "").slice(0, 3)).toUpperCase();
        const pct = parseFloat($("#jp", bg).value);
        if (!name) { $("#err", bg).textContent = "Give the jar a name."; return; }
        if (isNaN(pct) || pct < 0 || pct > 100) { $("#err", bg).textContent = "Share must be between 0 and 100."; return; }
        const rec = editing ? Object.assign(jar, { name, short, pct, color })
          : { id: uid(), name, short, pct, color, archived: false, sort: S.jars.length };
        if (!editing) S.jars.push(rec);
        persist("jar", rec); close(); render(); toast(editing ? "Jar saved" : "Jar added");
      };
    });
  }

  function openSettings() {
    sheet(`
      <div class="sheet-head"><h3>Budget & profile</h3><button class="close" data-close aria-label="Close">${I.x}</button></div>
      <form id="setForm" novalidate style="display:flex;flex-direction:column;gap:14px">
        <label class="f">Your name<input id="sn" value="${esc(S.profile.name)}" autocomplete="name"></label>
        <label class="f">Monthly budget (₱)<input id="sb" inputmode="decimal" value="${S.profile.budget}" autocomplete="off"></label>
        <p class="of" style="margin:-6px 0 0">This is the money you split into jars each month. Usually your monthly take-home income.</p>
        <p class="err" id="err"></p>
        <div class="sticky-save" style="flex-direction:column">
          <button type="submit" class="btn block">Save</button>
          ${CLOUD ? '<button type="button" class="btn ghost block" id="logout">Sign out</button>' : '<button type="button" class="btn ghost block" id="export">Copy backup of my data</button>'}
        </div>
      </form>`, (bg, close) => {
      $("#setForm", bg).onsubmit = (e) => {
        e.preventDefault();
        const budget = parseFloat(String($("#sb", bg).value).replace(/[,₱\s]/g, ""));
        if (!budget || budget <= 0) { $("#err", bg).textContent = "Enter a budget above zero."; return; }
        S.profile.name = $("#sn", bg).value.trim() || S.profile.name; S.profile.budget = budget;
        persist("profile"); close(); render(); toast("Budget updated");
      };
      const lo = $("#logout", bg); if (lo) lo.onclick = async () => { await sb.auth.signOut(); location.reload(); };
      const ex = $("#export", bg); if (ex) ex.onclick = async () => {
        const data = JSON.stringify({ profile: S.profile, jars: S.jars, txs: S.txs });
        try { await navigator.clipboard.writeText(data); toast("Backup copied"); } catch (err) { toast("Couldn't copy on this device"); }
      };
    });
  }

  // ---------- onboarding + auth ----------
  function renderOnboarding(root) {
    root.innerHTML = `<div class="auth">
      <img src="icon.svg" class="logo" alt="">
      <div><h1>Set up your jars</h1><p>Tell us your monthly budget and we'll split it into 6 jars. You can change everything later.</p></div>
      <form id="ob" novalidate>
        <label class="f">Your name<input id="on" autocomplete="name" placeholder="Kennedy"></label>
        <label class="f">Monthly budget (₱)<input id="ob_b" inputmode="decimal" placeholder="10,000"></label>
        <p class="err" id="err"></p>
        <button class="btn block" type="submit">Create my jars</button>
      </form>
      <p class="mode-note">${CLOUD ? "Your jars sync to your account." : "Local mode: data is saved on this device only."}</p></div>`;
    $("#ob").onsubmit = async (e) => {
      e.preventDefault();
      const name = $("#on").value.trim();
      const budget = parseFloat($("#ob_b").value.replace(/[,₱\s]/g, ""));
      if (!name) { $("#err").textContent = "Enter your name."; return; }
      if (!budget || budget <= 0) { $("#err").textContent = "Enter a budget above zero."; return; }
      S.profile = { name, budget };
      if (!S.jars.length) S.jars = DEFAULT_JARS.map((j, i) => ({ ...j, id: uid(), archived: false, sort: i }));
      await persist("profile");
      if (CLOUD) await persist("jars", S.jars);
      location.hash = "home"; render();
    };
  }

  function renderAuth(mode = "in", msg = "") {
    $("#root").innerHTML = `<div class="auth">
      <img src="icon.svg" class="logo" alt="">
      <div><h1>MMI Jar System</h1><p>Give every peso a job.</p></div>
      <form id="af" novalidate>
        <label class="f">Email<input id="ae" type="email" autocomplete="email" required></label>
        <label class="f">Password<input id="ap" type="password" autocomplete="${mode === "in" ? "current-password" : "new-password"}" minlength="6" required></label>
        <p class="err" id="err">${esc(msg)}</p>
        <button class="btn block" type="submit">${mode === "in" ? "Sign in" : "Create account"}</button>
        <button class="btn ghost block" type="button" id="swap">${mode === "in" ? "New here? Create an account" : "Have an account? Sign in"}</button>
      </form></div>`;
    $("#swap").onclick = () => renderAuth(mode === "in" ? "up" : "in");
    $("#af").onsubmit = async (e) => {
      e.preventDefault();
      const email = $("#ae").value.trim(), password = $("#ap").value;
      if (!email || password.length < 6) { $("#err").textContent = "Enter your email and a password of at least 6 characters."; return; }
      $("#err").textContent = "";
      const btn = e.submitter || $("#af button[type=submit]"); btn.disabled = true;
      const r = mode === "in" ? await sb.auth.signInWithPassword({ email, password }) : await sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
      btn.disabled = false;
      if (r.error) { $("#err").textContent = r.error.message; return; }
      if (mode === "up" && !r.data.session) return renderAuth("in", "Check your email to confirm your account, then sign in here.");
      boot();
    };
  }

  // ---------- boot ----------
  async function boot() {
    try {
      if (CLOUD && !(await Cloud.user())) return renderAuth();
      const d = CLOUD ? await Cloud.load() : await Local.load();
      S.profile = d.profile; S.jars = d.jars || []; S.txs = d.txs || [];
      render();
    } catch (e) {
      console.error(e);
      $("#root").innerHTML = `<div class="auth"><h1>Couldn't load your jars</h1><p>${esc(e.message || "Unknown error")}</p><button class="btn" onclick="location.reload()">Try again</button></div>`;
    }
  }
  boot();
})();
