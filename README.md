# ihopedanriceloses

A front-end-only Sleeper fantasy football matchup tracker, live at https://downwithdanrice.us.

It's plain `index.html` + `styles.css` + `app.js`, with no build step, talking directly to the public [Sleeper API](https://docs.sleeper.com/) (no API key needed). It shows:

- the tracked team's score vs. its opponent this week, auto-refreshing every minute during the live week
- projected final scores and each team's chance of winning (see below)
- both starting lineups side by side, plus benches, with per-player projections
- a week picker and a season-to-date list of results
- dark mode by default, with a light/dark toggle in the header (remembered per browser)

## Projections and win chance

Projections come from undocumented endpoints the Sleeper app itself uses (`api.sleeper.com/projections` and `/scores`), so they could change without notice; if they fail, the page still shows scores.

- Each player's projected stats are scored with the league's own scoring settings.
- During games, a player's projection is what they've scored so far plus their projection for the share of their game still left (from the live game clock). Players on bye or without a projection count as done.
- Win chance treats each team's final score as a normal distribution around its projected total, with a spread of about `0.4 × projection + 2` points per player that shrinks as games run out. It's a rough estimate, not Sleeper's own number.

## Changing the tracked team

The page always shows one team, set in `CONFIG` at the top of `app.js`:

```js
const CONFIG = {
  leagueId: "1389695275588657152",
  rosterId: "10", // drrice2
  nickname: "Dan", // used in the headline
};
```

## Projections and win chance

Projections come from undocumented endpoints the Sleeper app itself uses (`api.sleeper.com/projections` and `/scores`), so they could change without notice; if they fail, the page still shows scores.

- Each player's projected stats are scored with the league's own scoring settings.
- During games, a player's projection is what they've scored so far plus their projection for the share of their game still left (from the live game clock). Players on bye or without a projection count as done.
- Win chance treats each team's final score as a normal distribution around its projected total, with a spread of about `0.4 × projection + 2` points per player that shrinks as games run out. It's a rough estimate, not Sleeper's own number.

## Choosing the league and team

With nothing configured, the page asks for a Sleeper username (or a league ID), then which team to follow. That choice lives in the URL (`?league=...&roster=...`), so bookmark or share it.

To make a league and team the default for everyone visiting the domain, fill in `CONFIG` at the top of `app.js`:

```js
const CONFIG = {
  leagueId: "1234567890123456789",
  rosterId: "3",
};
```

The `roster=` value from the URL after picking a team is the `rosterId`.

## 1. Run it locally

Serve the folder (opening `index.html` directly from disk works too):

```sh
npx serve .            # or: python -m http.server 8000
```

## 2. Deploy to Cloudflare Pages

1. Push this repo to GitHub.
2. In the Cloudflare dashboard: **Workers & Pages → Create → Pages → Connect to Git**, pick this repo.
3. Build settings: Framework preset **None**, build command **empty**, output directory **`/`**.
4. Deploy. You get a free URL like `https://ihopedanriceloses.pages.dev`. It already has HTTPS.

Every push to `main` redeploys automatically.

## 3. Get a domain

Cloudflare Registrar is the simplest option, since the domain lands in your Cloudflare account already set up: **Domain Registration → Register Domains**.

If you buy the domain elsewhere (Namecheap, Porkbun, etc.), add it to Cloudflare (**Add a site**), then change the nameservers at your registrar to the two Cloudflare gives you. That can take anywhere from a few minutes to a few hours to take effect.

## 4. Attach the domain

In your Pages project: **Custom domains → Set up a custom domain** → enter `yourdomain.com` (and `www.yourdomain.com` too if you want it). Cloudflare creates the DNS record for you.

## 5. The certificate

You don't need to buy one. Cloudflare issues a free TLS certificate for the custom domain automatically, usually within a few minutes. Once it's active, the page will show **HTTPS 🔒 (certificate working)** at your domain.

To look at the cert yourself: click the padlock in the browser address bar, or run

```sh
curl -vI https://yourdomain.com 2>&1 | grep -iE "subject|issuer|expire"
```
