# Snip CLI

A zero-dependency Node.js command-line client for the Snip URL shortener API.
Node.js 20 or newer is required.

Run `node cli.js help` or use the included `snip`, `snip.cmd`, or `snip.ps1`
wrapper for `add <url>`, `ls`, and `open <code>`. The API defaults to
`http://localhost:3000`; set `SNIP_API` to use another API origin.

Install the package globally with `npm install -g .` to use the `snip` command.
