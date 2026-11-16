#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');

const DEFAULT_API = 'http://localhost:3000';
const USAGE = `Usage:
  snip add <url>    Create a short link
  snip ls           List all links
  snip open <code>  Open the original URL for a short code
  snip help         Show this help

Set SNIP_API to use a different API origin (default: ${DEFAULT_API}).`;

function apiBase() {
  return (process.env.SNIP_API || DEFAULT_API).replace(/\/+$/, '');
}

function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('URL must be a valid http or https URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('URL must use http or https.');
  }
  return url.href;
}

async function request(pathname, options) {
  let response;
  try {
    response = await fetch(`${apiBase()}${pathname}`, {
      ...options,
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error('Request to Snip API timed out.');
    }
    throw new Error(`Could not reach Snip API: ${error.message}`);
  }
  return response;
}

async function responseJson(response) {
  try {
    return await response.json();
  } catch {
    throw new Error(`Snip API returned invalid JSON (HTTP ${response.status}).`);
  }
}

async function add(urlArg) {
  if (!urlArg) throw new Error('Missing URL. Usage: snip add <url>');
  const url = validateUrl(urlArg);
  const response = await request('/api/links', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const body = await responseJson(response);
  if (!response.ok) {
    throw new Error(body.error || `Snip API request failed (HTTP ${response.status}).`);
  }
  if (typeof body.shortUrl !== 'string' || !body.shortUrl) {
    throw new Error('Snip API response is missing shortUrl.');
  }
  console.log(body.shortUrl);
}

async function list() {
  const response = await request('/api/links');
  const links = await responseJson(response);
  if (!response.ok) {
    throw new Error(links.error || `Snip API request failed (HTTP ${response.status}).`);
  }
  if (!Array.isArray(links)) throw new Error('Snip API response is not a links array.');
  if (links.length === 0) {
    console.log('No links yet.');
    return;
  }

  const rows = links.map((link) => ({
    code: String(link.code ?? ''),
    hits: String(link.hits ?? ''),
    url: String(link.url ?? ''),
  }));
  const codeWidth = Math.max(4, ...rows.map(({ code }) => code.length));
  const hitsWidth = Math.max(4, ...rows.map(({ hits }) => hits.length));
  console.log(`${'code'.padEnd(codeWidth)}  ${'hits'.padStart(hitsWidth)}  url`);
  for (const row of rows) {
    console.log(`${row.code.padEnd(codeWidth)}  ${row.hits.padStart(hitsWidth)}  ${row.url}`);
  }
}

function openInBrowser(target) {
  const url = validateUrl(target);
  const platform = process.platform;
  let command;
  let args;
  if (platform === 'win32') {
    command = 'cmd.exe';
    args = ['/d', '/s', '/c', `start "" "${url}"`];
  } else if (platform === 'darwin') {
    command = 'open';
    args = [url];
  } else {
    command = 'xdg-open';
    args = [url];
  }

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      windowsVerbatimArguments: platform === 'win32',
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

async function open(code) {
  if (!code) throw new Error('Missing short code. Usage: snip open <code>');
  if (!/^[a-zA-Z0-9]{6}$/.test(code)) {
    throw new Error('Short code must be exactly 6 alphanumeric characters.');
  }
  const response = await request(`/${encodeURIComponent(code)}`, { redirect: 'manual' });
  if (response.status === 404) throw new Error(`Unknown short code: ${code}`);
  if (response.status !== 302) {
    const body = await responseJson(response);
    throw new Error(body.error || `Unexpected response from Snip API (HTTP ${response.status}).`);
  }
  const location = response.headers.get('location');
  if (!location) throw new Error('Snip API redirect is missing its Location header.');
  try {
    await openInBrowser(location);
  } catch (error) {
    throw new Error(`Could not open browser: ${error.message}`);
  }
}

async function main(args) {
  const [command, ...rest] = args;
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }
  if (command === 'add') {
    if (rest.length !== 1) throw new Error('Usage: snip add <url>');
    await add(rest[0]);
    return;
  }
  if (command === 'ls') {
    if (rest.length !== 0) throw new Error('Usage: snip ls');
    await list();
    return;
  }
  if (command === 'open') {
    if (rest.length !== 1) throw new Error('Usage: snip open <code>');
    await open(rest[0]);
    return;
  }
  throw new Error(`Unknown command: ${command}\n\n${USAGE}`);
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
