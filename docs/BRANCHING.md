# Branching & Release Policy

## Branches

| Branch | Purpose | What lives here |
|--------|---------|-----------------|
| `master` | Active development | Latest commits, may contain unreleased features and audit stubs |
| `stable` | What gets tagged and installed | Only changes that have passed the promotion checklist below |
| `feature/*` | Short-lived feature branches off `master` | One feature per branch, deleted after merge |

**Agents and other consumers should install from a tag on `stable`, not from a branch HEAD.** Branches move; tags don't.

## Promotion: master → stable

A change graduates from `master` to `stable` when **all** of these are true:

1. **All 34 automated tests pass** (`npm test`) on the change in `master`
2. **The change has been used by the maintainer or another agent for at least one task end-to-end** — not just unit tests
3. **No new audit stubs or `Not yet implemented` responses** have been added (stable removes stubs that exist on master)
4. **CHANGELOG entry exists** for the upcoming release covering this change
5. **Maintainer has explicitly decided this batch is releasable** — promotion is not automatic

## How promotion happens

```bash
git checkout stable
git merge master --no-edit  # or cherry-pick specific commits if a partial promotion
# resolve any conflicts (typically .npmignore or audit stub differences)
npm test                    # must pass before tagging
npm pack --dry-run          # eyeball the file list
git tag v<NEXT-VERSION>
git push origin stable --tags
```

## Versioning

Semantic versioning, applied to the `stable` branch:

- **Major** (`5.0.0`) — breaking change to MCP tool schema, CLI argument, or config file format
- **Minor** (`4.3.0`) — new tool, new audit, new flag (additive)
- **Patch** (`4.2.1`) — bug fix, doc update, test-only change

Pre-release tags (`-beta.1`, `-rc.1`) are allowed for testing risky changes before promotion.

## What if I find a bug in `stable` and need to fix it fast?

1. Branch from `stable` directly (`git checkout -b hotfix/<name> stable`)
2. Fix + add a regression test
3. Merge to `stable` and bump patch version (`v4.2.0` → `v4.2.1`)
4. Cherry-pick the same fix to `master` so it doesn't regress

## Who decides

Solo maintainer (Edward Shamosh / @Zbrooklyn) for now. If/when the project takes outside contributors, this section will be updated to describe the review process.

## Anti-patterns

- **Don't push directly to `stable`** without going through master first (except hotfixes per above)
- **Don't smuggle features into a "stabilization" release** — features get their own minor bump
- **Don't tag without running `npm test` first** — no exceptions, even for "obvious" patch fixes
- **Don't reuse a version number** even if you `git tag -d` locally — once it's pushed, it's gone forever
