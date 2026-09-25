'use strict';

/**
 * What stops a web page -- this one, or any other -- from doing more with
 * inkd than reading and writing the folder it was opened on, at the
 * request of the person using it.
 *
 * Three different attacks, three different defences, and none of them is
 * sufficient alone:
 *
 * 1. A markdown file in a cloned repository containing script. Rendered
 *    naively, it would run in this origin and could call the write API.
 *    The page sanitises what it renders; this Content-Security-Policy is the
 *    backstop that refuses to run any script inkd did not ship itself.
 *
 * 2. Another website, open in the same browser, sending requests to
 *    127.0.0.1. It cannot read the answers (no CORS headers are ever sent),
 *    but it can *send* a write. So writes need an Origin that is inkd's own.
 *
 * 3. DNS rebinding: a site whose name is re-pointed at 127.0.0.1, so its
 *    requests count as same-origin to the browser. The Host header still
 *    carries the attacker's name, so requests are only answered for the
 *    addresses inkd actually listens on.
 */

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self'",
  // Remote images are allowed because READMEs are full of badges and a
  // viewer that breaks them looks broken. no-referrer below means they are
  // fetched without saying which file, or which folder, they appeared in.
  "img-src 'self' data: https:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'"
].join('; ');

/** Headers on every response. */
function baseHeaders() {
  return {
    'Content-Security-Policy': CONTENT_SECURITY_POLICY,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'X-Frame-Options': 'DENY'
  };
}

/**
 * For files served raw -- images, most of all SVG. An SVG is a document that
 * can carry script, and opened directly it would run as inkd. `sandbox`
 * gives it an origin of its own with scripts off, so the worst a hostile SVG
 * can do is draw itself.
 */
const RAW_CONTENT_SECURITY_POLICY = "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox";

/** The Host values inkd answers to, for the port it is on. */
function allowedHosts(port) {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

/** Refuse anything addressed by another name -- see (3) above. */
function hostIsAllowed(req, port) {
  return allowedHosts(port).has(String(req.headers.host || '').toLowerCase());
}

/**
 * Whether a request that changes something came from inkd's own page --
 * see (2) above. A missing Origin is refused too: browsers send one on every
 * write they make, and only a request crafted outside a browser leaves it
 * out, which is not what this API is for.
 */
function originIsAllowed(req, port) {
  const origin = String(req.headers.origin || '').toLowerCase();
  return [...allowedHosts(port)].some(host => origin === `http://${host}`);
}

module.exports = {
  CONTENT_SECURITY_POLICY,
  RAW_CONTENT_SECURITY_POLICY,
  baseHeaders,
  hostIsAllowed,
  originIsAllowed
};
