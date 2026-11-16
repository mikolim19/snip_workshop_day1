# Snip backend

A zero-dependency Bun URL shortener with an in-memory link store.

Run with `bun start` (port 3000 by default). Set `BASE_URL` to the public
origin when deployed; otherwise the server uses `RAILWAY_PUBLIC_DOMAIN` or
`http://localhost:<PORT>`. Set `PUBLIC_DIR` to serve an optional static site.

`POST /api/links` creates a short link, `GET /api/links` lists links, and
`GET /:code` redirects to the original URL and increments its hit count.
