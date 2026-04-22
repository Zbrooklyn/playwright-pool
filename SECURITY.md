# Security Policy

## Supported Versions

Only the latest tagged release receives security updates.

| Version | Supported |
|---------|:---:|
| 4.2.x   | Yes |
| < 4.2   | No  |

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

## Golden Profile — Threat Model

The "golden profile" is a Chromium user-data directory containing your authenticated session for sites you've logged into manually (Gmail, GitHub, Klaviyo, etc.). `playwright-pool` overlays 13 specific files from this profile onto fresh browser contexts so AI agents can act as you on those sites without re-authenticating.

This is a deliberate convenience-vs-security tradeoff. Users must understand it.

### What's stored in the golden profile

- **Cookies** (`Default/Network/Cookies`) — session tokens for every site you've logged into
- **Login Data** (`Default/Login Data`, `Default/Login Data For Account`) — saved passwords (encrypted with OS-level keys, but decryptable by anyone with access to your user account)
- **Web Data** (`Default/Web Data`) — autofill data, saved form values
- **Preferences** (`Default/Preferences`) — browser settings, possibly including sync state

### What an attacker with read access to the golden profile can do

| Capability | Notes |
|------------|-------|
| Authenticate as you on any logged-in site | Until you log out or the session token expires (some last months) |
| Read saved passwords on the same machine | OS-bound encryption; passwords are not exfiltrable to a different machine without the OS keychain |
| Steal autofill data (addresses, credit cards if saved) | |
| Use this access without two-factor prompts | Cookies bypass 2FA for already-authenticated sessions |

### What they cannot do (without additional access)

- Decrypt saved passwords on a different machine — OS keychain is required
- Reset your passwords — those flows usually require email confirmation
- Access sites you've never logged into

### Mitigations

If you use `playwright-pool`, **assume the golden profile directory is as sensitive as your password manager file.** Specifically:

1. **Filesystem permissions:** restrict the directory to your user only (Linux/Mac: `chmod 700 ~/.playwright-pool/golden-profile`; Windows: confirm only your user has access via Properties → Security)
2. **Don't sync to cloud:** exclude `~/.playwright-pool/` from Dropbox, OneDrive, iCloud, Google Drive, etc.
3. **Don't commit to git:** included in the project's `.gitignore`, but verify in any wrapper repo
4. **Don't share:** never copy the directory to another machine, another user, or a teammate. If two agents on different machines need auth, they each create their own golden profile via `playwright-pool login`
5. **Use a dedicated browser identity for AI agent work:** consider creating a separate Google account, GitHub account, etc. for sites the agent needs to access, so a profile leak doesn't compromise your primary identity
6. **Rotate when something feels off:** if you suspect the profile has leaked, log out of every account it had access to and delete the directory. Recreate via `playwright-pool login`
7. **Audit periodically:** browse the contents (Chrome → `chrome://settings/passwords` shows what's saved; cookie database can be inspected with SQLite tools) so you know what's at stake

### What the project does NOT do

- We do not transmit your golden profile anywhere
- We do not include any telemetry, analytics, or "phone home" code
- We do not modify your default Chromium profile — `playwright-pool` uses a separate directory specified by `GOLDEN_PROFILE`

### What we recommend AGAINST

- **Sharing one golden profile across multiple physical machines.** Either each machine has its own, or you accept that compromise of one is compromise of all.
- **Using your daily-driver browser profile as the golden profile.** Make a fresh one. The `playwright-pool login` flow exists for this reason.

## Scope (for vulnerability reports)

In scope:
- Code execution via crafted MCP tool arguments
- Path traversal in screenshot/save/PDF operations
- Unintended credential leakage beyond the documented overlay (e.g., exfiltration over network, logs containing tokens)
- Prototype pollution or argument injection in the audit handlers
- Bugs that cause `playwright-pool` to read or write outside the configured `GOLDEN_PROFILE` and `POOL_DIR`

Out of scope:
- Vulnerabilities in upstream dependencies (Playwright, Node, Chromium) — report those upstream
- Issues that require physical access to the user's machine
- Issues requiring the attacker to already have full filesystem access
- Browser bugs that affect Chromium independently of `playwright-pool`
- The documented golden profile capability (sharing your auth) is by-design, not a vulnerability

## Disclosure Timeline

We follow coordinated disclosure:
1. You report privately
2. We acknowledge within 3 business days
3. We investigate and develop a fix
4. We publish a patched release and a security advisory
5. We credit you (with your permission) in the advisory

We aim to resolve confirmed critical vulnerabilities within **14 days** of acknowledgment.

## Hardening Recommendations

If you run `playwright-pool` in production or a shared environment:

- Run the MCP server under a dedicated user, not root/Administrator
- Restrict the `GOLDEN_PROFILE` directory to that user only (see Mitigations above)
- Don't expose the CDP port to the network — it grants full browser control to anyone who can reach it
- Don't share `~/.playwright-pool/golden-profile` across machines or users
