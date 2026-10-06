# ihopedanriceloses

A one-page static site (just `index.html`, no build step) for practicing the trip from "runs on my machine" to "live on the internet at my own domain with HTTPS."

The page shows the hostname and protocol it was loaded from, so you can tell at a glance whether you're on localhost or the real domain, and whether HTTPS is working.

## 1. Run it locally

Open `index.html` in a browser, or serve it:

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
