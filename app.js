// The league and team this page tracks.
const CONFIG = {
  leagueId: "1389695275588657152",
  rosterId: "10", // drrice2
  nickname: "Dan", // used in the headline
};

const API = "https://api.sleeper.app/v1";
// Undocumented endpoints the Sleeper app itself uses for projections and live game clocks.
const APP_API = "https://api.sleeper.com";
const REFRESH_MS = 60 * 1000;
const PLAYERS_KEY = "sleeper-players-v1";
const PLAYERS_TTL = 24 * 60 * 60 * 1000; // Sleeper asks that /players/nfl be fetched at most once a day
const MAX_WEEK = 18;
const NON_STARTER_SLOTS = ["BN", "IR", "TAXI"];
const SLOT_LABELS = { FLEX: "FLX", SUPER_FLEX: "SF", REC_FLEX: "W/T", WRRB_FLEX: "W/R", IDP_FLEX: "IDP" };
const PROJECTION_POSITIONS = ["QB", "RB", "WR", "TE", "K", "DEF", "DL", "LB", "DB"];
// Projection stat keys that don't match a league scoring key one-to-one.
const SCORING_ALIASES = {
  fgm_50p: "fgm_50_59",
  fgmiss_0_19: "fgmiss",
  fgmiss_20_29: "fgmiss",
  fgmiss_30_39: "fgmiss",
  fgmiss_40_49: "fgmiss",
  fgmiss_50p: "fgmiss",
};

const params = new URLSearchParams(location.search);
const leagueId = CONFIG.leagueId;
const rosterId = Number(CONFIG.rosterId);

const app = document.getElementById("app");

// ---------- theme ----------

const themeToggle = document.getElementById("theme-toggle");

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  themeToggle.textContent = theme === "dark" ? "☀️" : "🌙";
  themeToggle.title = theme === "dark" ? "Switch to light mode" : "Switch to dark mode";
}

applyTheme(document.documentElement.dataset.theme || "dark");
themeToggle.addEventListener("click", () => {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(next);
  try {
    localStorage.setItem("theme", next);
  } catch {}
});

const footer = document.getElementById("footer");

// ---------- helpers ----------

async function api(path, base = API) {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`Sleeper API returned ${res.status} for ${path}`);
  return res.json();
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

const fmt = n => (n ?? 0).toFixed(2);
const score = m => (m ? m.custom_points ?? m.points ?? 0 : 0);

function showError(message) {
  app.innerHTML = `<section><p class="status error">${esc(message)}</p></section>`;
}

// Player names come from one large (~15 MB) endpoint, so keep a trimmed copy for a day.
async function loadPlayers() {
  try {
    const cached = JSON.parse(localStorage.getItem(PLAYERS_KEY));
    if (cached && Date.now() - cached.at < PLAYERS_TTL) return cached.players;
  } catch {}

  const raw = await api("/players/nfl");
  const players = {};
  for (const [id, p] of Object.entries(raw)) {
    players[id] = [`${p.first_name ?? ""} ${p.last_name ?? ""}`.trim(), p.position ?? "", p.team ?? ""];
  }
  try {
    localStorage.setItem(PLAYERS_KEY, JSON.stringify({ at: Date.now(), players }));
  } catch {}
  return players;
}

// ---------- projections & win chance ----------

function fantasyPoints(stats, scoring) {
  let pts = 0;
  for (const [key, value] of Object.entries(stats ?? {})) {
    const weight = scoring[key] ?? scoring[SCORING_ALIASES[key]];
    if (typeof value === "number" && weight) pts += weight * value;
  }
  return pts;
}

// Share of a game still to be played: 1 before kickoff, 0 once it's over.
function remainingFraction(game) {
  if (game.status === "complete") return 0;
  if (game.status !== "in_progress") return 1;
  const m = game.metadata ?? {};
  const [min, sec] = String(m.time_remaining ?? "0:00").split(":").map(Number);
  const minutesLeft = (4 - (m.quarter_num ?? 4)) * 15 + (min || 0) + (sec || 0) / 60;
  return Math.min(Math.max(minutesLeft / 60, 0), 1);
}

async function loadOutlook(ctx, week) {
  const season = ctx.league.season;
  if (!ctx.projections[week]) {
    const positions = PROJECTION_POSITIONS.map(p => `position[]=${p}`).join("&");
    const rows = await api(`/projections/nfl/${season}/${week}?season_type=regular&${positions}`, APP_API);
    const proj = {};
    for (const r of rows) {
      proj[r.player_id] = { pts: fantasyPoints(r.stats, ctx.league.scoring_settings), team: r.team ?? r.player?.team };
    }
    ctx.projections[week] = proj;
  }
  const games = await api(`/scores/nfl/regular/${season}/${week}`, APP_API);
  const remaining = {};
  for (const g of games) {
    const frac = remainingFraction(g);
    remaining[g.metadata?.home_team] = frac;
    remaining[g.metadata?.away_team] = frac;
  }
  return { proj: ctx.projections[week], remaining };
}

// Expected final points for one player: what they have plus their projection for the time left.
// Teams on bye, and players without a projection, are treated as done.
function playerOutlook(id, actual, ol) {
  const p = ol.proj[id];
  const frac = p ? ol.remaining[p.team] ?? 0 : 0;
  const pts = p?.pts ?? 0;
  // Rough spread of a player's score around their projection, shrinking as their game runs out.
  const sd = p ? (0.4 * pts + 2) * Math.sqrt(frac) : 0;
  return { mean: actual + pts * frac, variance: sd * sd, live: frac > 0 };
}

function teamOutlook(m, ol) {
  let mean = 0;
  let variance = 0;
  for (const id of m?.starters ?? []) {
    if (!id || id === "0") continue;
    const p = playerOutlook(id, m.players_points?.[id] ?? 0, ol);
    mean += p.mean;
    variance += p.variance;
  }
  return { mean, variance };
}

function normalCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function winChance(a, b) {
  const sd = Math.sqrt(a.variance + b.variance);
  if (sd === 0) return a.mean > b.mean ? 1 : a.mean < b.mean ? 0 : 0.5;
  return normalCdf((a.mean - b.mean) / sd);
}

function teamFromRoster(roster, usersById) {
  const user = usersById[roster.owner_id];
  const s = roster.settings ?? {};
  return {
    rosterId: roster.roster_id,
    name: user?.metadata?.team_name || user?.display_name || `Team ${roster.roster_id}`,
    owner: user?.display_name || "No owner",
    avatar: user?.metadata?.avatar || (user?.avatar ? `https://sleepercdn.com/avatars/thumbs/${user.avatar}` : ""),
    record: `${s.wins ?? 0}-${s.losses ?? 0}${s.ties ? `-${s.ties}` : ""}`,
  };
}

function findMatchup(matchups, id) {
  const mine = matchups.find(m => m.roster_id === id);
  if (!mine || mine.matchup_id == null) return null;
  const opp = matchups.find(m => m.matchup_id === mine.matchup_id && m.roster_id !== id) ?? null;
  return { mine, opp };
}

// ---------- matchup view ----------

function headline(owner, a, b, final) {
  if (a === 0 && b === 0) return { text: `${owner}'s matchup hasn't started yet`, mood: "" };
  const diff = fmt(Math.abs(a - b));
  if (a === b) return { text: `${owner} ${final ? "tied" : "is tied"}`, mood: "" };
  const losing = a < b;
  const text = final
    ? (losing ? `${owner} lost by ${diff} 🎉` : `${owner} won by ${diff}`)
    : (losing ? `${owner} is losing by ${diff}` : `${owner} is winning by ${diff}`);
  return { text, mood: losing ? "good" : "bad" };
}

// ---------- cheering for Dan's opponent ----------

const CROWN_SVG = `
  <svg class="crown" viewBox="0 0 64 40" aria-hidden="true">
    <path d="M4 36 L8 12 L22 24 L32 6 L42 24 L56 12 L60 36 Z" />
    <circle cx="8" cy="10" r="4" /><circle cx="32" cy="5" r="4" /><circle cx="56" cy="10" r="4" />
  </svg>`;

const MEGAPHONE_SVG = `
  <svg class="megaphone" viewBox="0 0 64 64" aria-hidden="true">
    <path d="M6 25h12l26-13v40L18 39H6z" />
    <path d="M18 39l5 15h8l-4-13" />
    <path class="waves" d="M51 22c4 4 4 16 0 20M57 15c8 7 8 27 0 34" />
  </svg>`;

const CONFETTI_COLORS = ["#fbbf24", "#22c55e", "#38bdf8", "#f472b6", "#a78bfa", "#f87171"];

function confetti() {
  const bits = Array.from({ length: 36 }, (_, i) => {
    const style = [
      `--x: ${Math.random() * 100}%`,
      `--c: ${CONFETTI_COLORS[i % CONFETTI_COLORS.length]}`,
      `--d: ${2 + Math.random() * 2}s`,
      `--delay: ${Math.random() * 2}s`,
    ].join("; ");
    return `<span style="${style}"></span>`;
  });
  return `<div class="confetti" aria-hidden="true">${bits.join("")}</div>`;
}

// chance is the champ's win chance, when projections are available.
function cheer(champ, danPts, champPts, final, chance) {
  const name = champ.name;
  const odds = chance == null ? "" : ` The people give them a ${Math.round(chance * 100)}% chance.`;
  if (danPts === 0 && champPts === 0) {
    return { title: `Let's go, ${name}!`, sub: "Beat the brakes off of Dan this week!" };
  }
  const diff = fmt(Math.abs(champPts - danPts));
  if (final) {
    if (champPts > danPts) return { title: "The People's Champ has done it! 🏆", sub: `${name} beat Dan by ${diff}. The people rejoice.`, party: true };
    if (champPts === danPts) return { title: "A draw for the ages", sub: `${name} held Dan to a tie.` };
    return { title: "A valiant effort, Champ", sub: `${name} fell short by ${diff}. The people still believe.` };
  }
  if (champPts > danPts) return { title: `${name} is up ${diff}! Keep it rolling, Champ!`, sub: `Dan is on the ropes.${odds}` };
  if (champPts === danPts) return { title: "Dead even. Come on, Champ!", sub: `Every point counts.${odds}` };
  return { title: "Don't give up, Champ!", sub: `${name} is down ${diff}, but the people believe.${odds}` };
}

function cheerBanner(c) {
  return `
    <div class="cheer${c.party ? " party" : ""}">
      ${MEGAPHONE_SVG}
      <div>
        <p class="cheer-title">${esc(c.title)}</p>
        <p class="cheer-sub">${esc(c.sub)}</p>
      </div>
      ${c.party ? confetti() : ""}
    </div>`;
}

// Sits in the empty space left of the scoreboard on wide screens, below it otherwise.
const ENEMY_HTML = `
  <figure class="enemy">
    <figcaption>Also an enemy of the league</figcaption>
    <img src="patrick-gm.jpg" alt="Patrick Siegmund, General Manager of the St. Louis Stallions" width="1122" height="1402" loading="lazy">
  </figure>`;

// role: "champ" for Dan's opponent, "lucky" for Dan.
function teamBlock(team, pts, ahead, outlook, role) {
  const champ = role === "champ";
  if (!team) return `<div class="team"><div class="tname">No opponent</div></div>`;
  const img = team.avatar
    ? `<img src="${esc(team.avatar)}" alt="" onerror="this.style.visibility='hidden'">`
    : `<div class="avatar-ph"></div>`;
  const proj = outlook ? `<div class="proj">Proj ${fmt(outlook.mean)}</div>` : "";
  const belt = champ
    ? `<div class="belt"><span class="deco">★ </span>The People's Champ<span class="deco"> ★</span></div>`
    : role === "lucky"
      ? `<div class="belt lucky" title="Luckiest Fantasy Player Alive"><span class="deco">🍀 </span><span class="long">Luckiest Fantasy Player Alive</span><span class="short">Luckiest Alive</span><span class="deco"> 🍀</span></div>`
      : "";
  return `
    <div class="team${ahead ? " ahead" : ""}${champ ? " champ" : ""}">
      <div class="avatar-wrap">${champ ? CROWN_SVG : ""}${img}</div>
      <div class="tname">${esc(team.name)}</div>
      <div class="owner">${esc(team.owner)} · ${esc(team.record)}</div>
      <div class="pts">${fmt(pts)}</div>
      ${proj}
      ${belt}
    </div>`;
}

function winBar(chance, who) {
  const pct = Math.round(chance * 100);
  return `
    <div class="winprob" title="Estimated from projections and how much of each game is left">
      <div class="wp-labels"><span>${esc(who)} ${pct}%</span><span>Win chance</span><span>Champ ${100 - pct}%</span></div>
      <div class="wp-bar"><span style="width: ${pct}%"></span></div>
    </div>`;
}

function playerCell(id, pointsById, players, ol, right = false) {
  const side = right ? " right" : "";
  if (!id || id === "0") {
    return `<div class="player empty${side}"><div class="who"><div class="name">Empty</div></div></div>`;
  }
  const [name, pos, team] = players?.[id] ?? [id, "", ""];
  const meta = [pos, team].filter(Boolean).join(" · ");
  const actual = pointsById?.[id] ?? 0;
  const p = ol && playerOutlook(id, actual, ol);
  const proj = p?.live ? `<small>proj ${fmt(p.mean)}</small>` : "";
  return `
    <div class="player${side}">
      <div class="who"><div class="name">${esc(name)}</div><div class="meta">${esc(meta)}</div></div>
      <div class="ppts">${fmt(actual)}${proj}</div>
    </div>`;
}

function benchList(m, players, ol) {
  if (!m) return "<div></div>";
  const bench = (m.players ?? [])
    .filter(id => !m.starters.includes(id))
    .sort((a, b) => (m.players_points?.[b] ?? 0) - (m.players_points?.[a] ?? 0));
  return `<div>${bench.map(id => playerCell(id, m.players_points, players, ol)).join("")}</div>`;
}

function lineups(ctx, pair, players, ol, who) {
  const { mine, opp } = pair;
  const rows = ctx.slots
    .map((slot, i) => `
      <div class="row">
        ${playerCell(mine.starters[i], mine.players_points, players, ol)}
        <span class="slot">${esc(SLOT_LABELS[slot] ?? slot)}</span>
        ${opp ? playerCell(opp.starters[i], opp.players_points, players, ol, true) : "<div></div>"}
      </div>`)
    .join("");
  return `
    <h2>Starters</h2>
    <div class="row head"><span>${esc(who)}</span><span></span><span class="champ-label">The People's Champ</span></div>
    ${rows}
    <details>
      <summary>Bench</summary>
      <div class="bench">${benchList(mine, players, ol)}${benchList(opp, players, ol)}</div>
    </details>`;
}

async function getMatchups(ctx, week) {
  // Finished weeks don't change, so only the live and upcoming weeks are re-fetched.
  if (!ctx.cache[week] || !ctx.isFinal(week)) {
    ctx.cache[week] = await api(`/league/${ctx.league.league_id}/matchups/${week}`);
  }
  return ctx.cache[week];
}

async function renderWeek(ctx) {
  const week = ctx.week;
  const scoreEl = document.getElementById("scoreboard");
  const lineupEl = document.getElementById("lineups");

  const final = ctx.isFinal(week);
  const [matchups, ol] = await Promise.all([
    getMatchups(ctx, week),
    // Projections are extra: if those endpoints fail, still show the scores.
    final ? null : loadOutlook(ctx, week).catch(() => null),
  ]);
  if (week !== ctx.week) return; // user switched weeks while this was loading

  const pair = findMatchup(matchups, rosterId);
  const me = ctx.teams[rosterId];

  if (!pair) {
    scoreEl.innerHTML = `<p class="status">${esc(me.owner)} has no matchup in week ${week}.</p>`;
    lineupEl.hidden = true;
  } else {
    const a = score(pair.mine);
    const b = score(pair.opp);
    const opp = pair.opp ? ctx.teams[pair.opp.roster_id] : null;
    const who = CONFIG.nickname || me.owner;
    const h = headline(who, a, b, final);
    const outA = ol && teamOutlook(pair.mine, ol);
    const outB = ol && pair.opp && teamOutlook(pair.opp, ol);
    const updated = ctx.isLive(week)
      ? `<p class="updated">Updated ${new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} · refreshes every minute</p>`
      : "";

    const chance = outA && outB ? winChance(outA, outB) : null;

    scoreEl.innerHTML = `
      ${opp ? cheerBanner(cheer(opp, a, b, final, chance == null ? null : 1 - chance)) : ""}
      <p class="headline ${h.mood}">${esc(h.text)}</p>
      <div class="score">
        ${teamBlock(me, a, a > b, outA, "lucky")}
        <div class="vs">vs</div>
        ${teamBlock(opp, b, b > a, outB, "champ")}
      </div>
      ${chance == null ? "" : winBar(chance, who)}
      ${updated}`;

    lineupEl.hidden = false;
    const players = await ctx.players;
    if (week !== ctx.week) return;
    const benchOpen = lineupEl.querySelector("details")?.open;
    lineupEl.innerHTML = lineups(ctx, pair, players, ol, who);
    if (benchOpen) lineupEl.querySelector("details").open = true;
  }

  renderHistory(ctx);
}

async function loadHistory(ctx) {
  const weeks = Array.from({ length: ctx.currentWeek }, (_, i) => i + 1);
  await Promise.all(weeks.filter(w => !ctx.cache[w]).map(w => getMatchups(ctx, w).catch(() => [])));
  renderHistory(ctx);
}

function renderHistory(ctx) {
  const el = document.getElementById("history-list");
  const rows = [];
  for (let w = 1; w <= ctx.currentWeek; w++) {
    const pair = ctx.cache[w] && findMatchup(ctx.cache[w], rosterId);
    if (!pair) continue;
    const a = score(pair.mine);
    const b = score(pair.opp);
    const opp = pair.opp ? ctx.teams[pair.opp.roster_id] : null;
    const live = ctx.isLive(w);
    const result = live ? "Live" : a > b ? "W" : a < b ? "L" : "T";
    rows.push(`
      <li><button data-week="${w}" class="${w === ctx.week ? "selected" : ""}">
        <span>Wk ${w}</span>
        <span class="opp">vs ${esc(opp?.name ?? "—")}</span>
        <span class="res ${live ? "" : result}">${result} ${fmt(a)}–${fmt(b)}</span>
      </button></li>`);
  }
  el.innerHTML = rows.join("") || `<li class="status">No games yet.</li>`;
}

function selectWeek(ctx, week) {
  ctx.week = week;
  document.getElementById("week").value = week;
  const url = new URL(location);
  url.searchParams.set("week", week);
  history.replaceState(null, "", url);
  renderWeek(ctx).catch(err => showError(err.message));
}

async function init() {
  const players = loadPlayers().catch(() => null); // names are nice-to-have; ids still render without them
  const [nfl, league, users, rosters] = await Promise.all([
    api("/state/nfl"),
    api(`/league/${leagueId}`),
    api(`/league/${leagueId}/users`),
    api(`/league/${leagueId}/rosters`),
  ]);
  if (!league) return showError(`No Sleeper league with ID ${leagueId}.`);

  const usersById = Object.fromEntries(users.map(u => [u.user_id, u]));
  const teams = Object.fromEntries(rosters.map(r => [r.roster_id, teamFromRoster(r, usersById)]));
  if (!teams[rosterId]) return showError(`No roster ${rosterId} in ${league.name}.`);

  const inSeason = league.season === nfl.season && league.status === "in_season";
  const currentWeek = inSeason
    ? Math.min(Math.max(nfl.week, 1), MAX_WEEK)
    : league.settings?.last_scored_leg || MAX_WEEK;

  const ctx = {
    league,
    teams,
    players,
    currentWeek,
    week: Math.min(Number(params.get("week")) || currentWeek, MAX_WEEK),
    slots: league.roster_positions.filter(p => !NON_STARTER_SLOTS.includes(p)),
    cache: {},
    projections: {},
    isLive: w => inSeason && w === currentWeek,
    isFinal: w => !inSeason || w < currentWeek,
  };

  document.getElementById("subtitle").textContent = `${league.name} · ${league.season}`;
  footer.textContent = "Data from Sleeper";

  const weekOptions = Array.from({ length: MAX_WEEK }, (_, i) => `<option value="${i + 1}">Week ${i + 1}</option>`).join("");
  app.innerHTML = `
    <div class="scorewrap">
      <section id="scoreboard"><p class="status">Loading matchup…</p></section>
      ${ENEMY_HTML}
    </div>
    <div class="weekbar"><select id="week" aria-label="Week">${weekOptions}</select></div>
    <section id="lineups" hidden></section>
    <section><h2>Season</h2><ul class="history" id="history-list"></ul></section>`;

  document.getElementById("week").value = ctx.week;
  document.getElementById("week").addEventListener("change", e => selectWeek(ctx, Number(e.target.value)));
  document.getElementById("history-list").addEventListener("click", e => {
    const btn = e.target.closest("button[data-week]");
    if (btn) selectWeek(ctx, Number(btn.dataset.week));
  });

  await renderWeek(ctx);
  loadHistory(ctx);

  // Keep the live week's score fresh while the tab is visible.
  const refresh = () => {
    if (document.visibilityState === "visible" && ctx.isLive(ctx.week)) renderWeek(ctx).catch(() => {});
  };
  setInterval(refresh, REFRESH_MS);
  document.addEventListener("visibilitychange", refresh);
}

init().catch(err => showError(err.message));
