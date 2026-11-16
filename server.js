import { isAbsolute, relative, resolve, sep } from "node:path";

const links = new Map();
const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

const port = Number(process.env.PORT ?? 3000);
const configuredBaseUrl =
  process.env.BASE_URL ??
  (process.env.RAILWAY_PUBLIC_DOMAIN
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
    : `http://localhost:${port}`);
const baseUrl = new URL(configuredBaseUrl).origin.replace(/\/+$/, "");
const publicDir = process.env.PUBLIC_DIR ? resolve(process.env.PUBLIC_DIR) : null;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function jsonResponse(data, status = 200) {
  return Response.json(data, {
    status,
    headers: corsHeaders,
  });
}

function createCode() {
  let code = "";
  const bytes = new Uint8Array(12);

  while (code.length < 6) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < 248) code += alphabet[byte % alphabet.length];
      if (code.length === 6) break;
    }
  }

  return code;
}

function createLink(url) {
  let code;
  do {
    code = createCode();
  } while (links.has(code));

  const link = {
    code,
    url,
    shortUrl: `${baseUrl}/${code}`,
    hits: 0,
    createdAt: new Date().toISOString(),
  };
  links.set(code, link);
  return link;
}

async function serveStatic(pathname) {
  if (!publicDir) return null;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.slice(1);
  const filePath = resolve(publicDir, relativePath);
  const pathFromRoot = relative(publicDir, filePath);
  if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) {
    return null;
  }

  const file = Bun.file(filePath);
  return (await file.exists()) ? new Response(file, { headers: corsHeaders }) : null;
}

Bun.serve({
  port,
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (pathname === "/api/links" && request.method === "GET") {
      return jsonResponse(Array.from(links.values()));
    }

    if (pathname === "/api/links" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return jsonResponse({ error: "Request body must be valid JSON." }, 400);
      }

      if (typeof body?.url !== "string") {
        return jsonResponse({ error: "A valid HTTP or HTTPS URL is required." }, 400);
      }

      let parsedUrl;
      try {
        parsedUrl = new URL(body.url);
      } catch {
        return jsonResponse({ error: "A valid HTTP or HTTPS URL is required." }, 400);
      }

      if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
        return jsonResponse({ error: "A valid HTTP or HTTPS URL is required." }, 400);
      }

      return jsonResponse(createLink(body.url), 201);
    }

    if (request.method === "GET") {
      const staticResponse = await serveStatic(pathname);
      if (staticResponse) return staticResponse;

      const code = pathname.slice(1);
      const link = links.get(code);
      if (link) {
        link.hits += 1;
        return new Response(null, {
          status: 302,
          headers: { ...corsHeaders, Location: link.url },
        });
      }
    }

    return jsonResponse({ error: "Not found." }, 404);
  },
});

console.log(`Snip backend listening on ${baseUrl}`);
