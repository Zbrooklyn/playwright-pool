# Security Policy

## Supported Versions

Only the latest published version receives security updates.

| Version | Supported |
|---------|:---:|
| 1.x     | Yes |
| < 1.0   | No  |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email security reports to: **edwardzbrooklyn@gmail.com**

Include:
1. A description of the vulnerability
2. Steps to reproduce (URL, command, payload, etc.)
3. The version of `playwright-pool` you tested against
4. Your suggested severity (low / medium / high / critical) and reasoning
5. Whether you would like public credit if a fix is published

You should receive an acknowledgment within **3 business days**. If the issue is confirmed, we'll work on a fix and coordinate disclosure with you.

## Scope

In scope:
- Code execution via crafted MCP tool arguments
- Path traversal in screenshot/save operations
- Credential leakage from the golden profile auth overlay
- Prototype pollution or argument injection in the audit handlers

Out of scope:
- Vulnerabilities in upstream dependencies (Playwright, Node) — report those upstream
- Issues that require physical access to the user's machine
- Issues requiring the attacker to already have full filesystem access
- Browser bugs that affect Chromium independently of `playwright-pool`

## Disclosure Timeline

We follow coordinated disclosure:
1. You report privately
2. We acknowledge within 3 business days
3. We investigate and develop a fix
4. We publish a patched release and a security advisory
5. We credit you (with your permission) in the advisory

We aim to resolve confirmed critical vulnerabilities within **14 days** of acknowledgment.

## Hardening Recommendations

If you run `playwright-pool` in production:

- Run the MCP server under a dedicated user, not root/Administrator
- Restrict the `GOLDEN_PROFILE` directory to that user only
- Don't expose the CDP port to the network — it grants full browser control
- Don't share `~/.playwright-pool/golden-profile` across machines or users — it contains your auth cookies
