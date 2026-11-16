# Snip frontend

The Angular 19 web client for Snip. It creates short links and lists each link's
original URL and visit count.

## Run locally

Start the Snip backend at `http://localhost:3000`, then run:

```sh
npm install
npx ng serve
```

Open `http://localhost:4200`. To build the production app, run `npx ng build`;
the output is in `dist/snip-frontend/browser`.

API requests use `/api/links` on the page's origin, so the generated Bun/Docker
bundle works on any host. During `ng serve`, `proxy.conf.json` forwards `/api` to
the local backend at `http://localhost:3000`.
