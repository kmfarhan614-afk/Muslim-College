'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const issues = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function fail(message) { issues.push(message); }
function warn(message) { warnings.push(message); }
function exists(rel) { return fs.existsSync(path.join(ROOT, rel)); }

let config;
try {
  config = JSON.parse(read('vercel.json'));
} catch (err) {
  fail('vercel.json is not valid JSON: ' + err.message);
  config = null;
}

if (config) {
  if (config.framework !== null) fail('vercel.json must set "framework": null (the Next scaffold is unused).');
  if (config.outputDirectory !== '.') fail('vercel.json must serve the repository root ("outputDirectory": ".").');
  if (!config.rewrites || !Array.isArray(config.rewrites)) fail('vercel.json has no rewrites array.');

  const rewrites = config.rewrites || [];
  const api = rewrites.filter(r => r.source === '/api' || r.source === '/api/:path*');
  if (api.length !== 2) fail('vercel.json needs both /api and /api/:path* rewrites.');

  for (const rule of api) {
    let url;
    try {
      url = new URL(rule.destination);
    } catch (err) {
      fail(rule.source + ' destination is not an absolute URL: ' + rule.destination);
      continue;
    }
    const host = url.hostname.toLowerCase();
    if (!/^https:$/.test(url.protocol)) fail(rule.source + ' must proxy to HTTPS in production: ' + rule.destination);
    if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(host)) fail(rule.source + ' must not use localhost as the production backend.');
    if (/your-backend|example\.com/i.test(host)) fail(rule.source + ' still contains the placeholder backend host.');
    if (host) {
      const target = url.pathname + url.search;
      if (rule.source === '/api' && target !== '/api') warn('/api should proxy to .../api (currently ' + target + ').');
    }
  }

  for (const rule of rewrites) {
    if (/^https?:/i.test(rule.destination)) continue;
    if (!exists(rule.destination.replace(/^\//, ''))) fail('Rewrite target is missing: ' + rule.source + ' -> ' + rule.destination);
  }
}

if (!exists('.vercelignore')) {
  fail('.vercelignore is missing.');
} else {
  const ignore = read('.vercelignore');
  for (const required of ['node_modules/', 'data/', 'server.js', 'tests/', '.env*']) {
    if (!ignore.split(/\r?\n/).includes(required)) fail('.vercelignore must exclude ' + required);
  }
  if (/^!?\.env\.local$/m.test(ignore)) fail('.vercelignore must not re-include .env.local.');
}

for (const file of ['index.html', '404.html', 'js/app.js', 'js/api.js', 'css/style.css', 'assets/logo.png']) {
  if (!exists(file)) fail('Missing runtime asset: ' + file);
}

if (fs.existsSync(path.join(ROOT, 'api')) && fs.statSync(path.join(ROOT, 'api')).isDirectory()) {
  fail('A top-level api/ directory would shadow the /api proxy.');
}

function localTargets(file) {
  const html = read(file);
  const targets = new Set();
  const re = /(?:href|src)="([^"]+)"/g;
  let match;
  while ((match = re.exec(html))) {
    let href = match[1].trim();
    if (!href || href.startsWith('#') || href.startsWith('//')) continue;
    if (/^(?:[a-z]+:)/i.test(href)) continue;
    href = href.split('#')[0].split('?')[0];
    if (!href) continue;
    const target = href.startsWith('/')
      ? path.join(ROOT, href.replace(/^\//, ''))
      : path.resolve(path.dirname(path.join(ROOT, file)), href);
    targets.add(target);
  }
  return targets;
}

const pages = fs.readdirSync(ROOT).filter(f => f.endsWith('.html'));
for (const page of pages) {
  for (const target of localTargets(page)) {
    if (fs.existsSync(target)) continue;
    if (fs.existsSync(path.join(target, 'index.html'))) continue;
    fail(page + ' links to a missing file: ' + path.relative(ROOT, target));
  }
}

if (!issues.length) {
  console.log('DEPLOY PREFLIGHT PASSED');
} else {
  console.log('DEPLOY PREFLIGHT FAILED');
}
for (const warning of warnings) console.log('  WARN  ' + warning);
for (const issue of issues) console.log('  FAIL  ' + issue);
process.exit(issues.length ? 1 : 0);
