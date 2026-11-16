# Snip

One in-memory Bun URL-shortening API, two clients: an Angular 19 web app and a
zero-dependency Node CLI. Restarting the API intentionally clears all links.

## Architecture

Each component has an independent orphan branch in this same repository. Files
live at that branch's root. `main` is a superproject: its submodules pin exact
component commits, not floating branch names.

| Branch / submodule | Contents |
| --- | --- |
| `backend` | Bun 1.x API, `server.js`, no npm dependencies |
| `frontend` | Angular 19 standalone app and typed HttpClient service |
| `cli` | CommonJS `cli.js`, Node 20+ global fetch, shell wrappers |
| `bundle` | GENERATED server, built UI, CLI, Dockerfile and Railway configuration |
| `main` | Submodule pointers, documentation, release tooling and CI |

## Shared API

| Method | Path | Body | Response |
| --- | --- | --- | --- |
| POST | `/api/links` | `{ "url": "https://example.com" }` | 201 `{ code, url, shortUrl, hits, createdAt }`; 400 `{ error }` for invalid JSON or a non-http(s) URL |
| GET | `/api/links` | - | 200 array of those objects |
| GET | `/:code` | - | 302 `Location` redirect and +1 hit; 404 `{ error }` if unknown |

Codes are six random base62 characters, hits begin at zero, and `createdAt` is an
ISO timestamp. CORS is open and OPTIONS preflight is supported.

## Clone and run

Requires Git, Bun 1.x, and Node 20+ with npm. Node 24 is used for release builds.

```powershell
git clone --recurse-submodules https://github.com/mikolim19/snip_workshop_day1.git
cd snip_workshop_day1
```

Plain clones leave submodules empty. Repair one with
`git submodule update --init --recursive`. Run each component in its own terminal:

```powershell
cd backend
bun start
```

```powershell
cd frontend
npm ci
npx ng serve
```

```powershell
cd cli
node cli.js add https://example.com
node cli.js ls
```

Open the UI at http://localhost:4200 and the API at http://localhost:3000/api/links.
The CLI and UI share the backend's links and hit counts. CLI `SNIP_API` overrides
its default origin. Backend `PORT` defaults to 3000; `BASE_URL` controls short-link
origins, otherwise `RAILWAY_PUBLIC_DOMAIN` supplies an HTTPS origin, then localhost
is the fallback. `PUBLIC_DIR` enables static serving (`/` serves `index.html`);
an existing static file takes precedence over a short code.

## Component update workflow

Make source changes on the matching component branch, push them, then record a
separate pointer update on `main`. Do not switch the shared checkout while another
person or agent owns it.

```powershell
cd backend
git switch backend
# Edit and verify the component.
git add server.js
git commit -m "Update backend"
git push origin HEAD:backend
cd ..
git submodule update --remote backend
git add backend
git commit -m "Bump backend submodule"
git push origin HEAD:main
```

Submodules may be checked out with detached HEADs; use an explicit destination
such as `HEAD:backend` when pushing. `git submodule update --init --recursive`
restores the pinned snapshot; `--remote` intentionally advances it.

## Generated release

`bundle/` is generated output, never a source-editing location. From a clean
`main` checkout:

```powershell
node scripts/build-bundle.mjs
node scripts/build-bundle.mjs
node scripts/build-bundle.mjs --push
node scripts/smoke-test.mjs
```

The script advances source submodules to their branch tips, restores the exact
frontend lockfile with `npm ci`, builds `dist/snip-frontend/browser`, and copies
the server and CLI unchanged. It records source SHAs in `bundle/sources.json`,
commits changed output and pointers only, and pushes explicit `HEAD:bundle` and
`HEAD:main` destinations only with `--push`. Repeated identical builds do not
create commits. A lock prevents concurrent builds, dirty component checkouts
and unrelated main changes are rejected, and divergent bundle history fails
rather than overwriting a release. Stop all component writers during a build.
If a process is forcibly terminated, inspect the workspace before removing its
stale `.release-build.lock`.

The web app uses same-origin API requests. The Angular development server proxies
`/api` to localhost:3000; a deployed bundle needs no localhost-specific UI config.
One process serves the whole release:

```powershell
cd bundle
bun start
# In a separate terminal, from bundle:
docker build -t snip .
docker run --rm -p 3000:3000 snip
```

Open http://localhost:3000. The Docker runtime uses the unprivileged `bun` user.
To deploy on Railway, choose the `bundle` branch, not `main`; the generated
`railway.json` selects its Dockerfile and `/api/links` health check. Railway injects
`PORT` and `RAILWAY_PUBLIC_DOMAIN`; set `BASE_URL` only to override the public
origin. No external Railway deployment or paid resource is created by this repo.
