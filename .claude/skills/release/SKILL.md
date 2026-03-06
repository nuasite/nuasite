Release a new version of packages.

## Instructions

Follow these steps exactly:

### 1. Determine the version bump

If the user provided arguments (e.g. `/release patch`, `/release 0.3.0`), use that. Otherwise, ask the user which version bump they want: patch, minor, major, or a specific version.

### 2. Preflight checks

- Verify you are on the `main` branch. If not, warn the user and ask for confirmation.
- Run `git status` to ensure the working tree is clean (no uncommitted changes). If dirty, stop and tell the user.
- Run `git pull --ff-only` to ensure the branch is up to date.

### 3. Read current version

Read `package.json` and note the current `version` field.

### 4. Generate changelog entry

Run `git tag -l 'v*' --sort=-v:refname` to find the latest existing tag. Then:

- If a previous tag exists: `git log <previous-tag>..HEAD --oneline --no-merges`
- If no tags exist: `git log --oneline --no-merges`

Group the commit messages into sections based on conventional commit prefixes:

- **Features** — `feat:` or `feat(...):` commits
- **Bug Fixes** — `fix:` or `fix(...):` commits
- **Other Changes** — everything else (refactor, chore, style, docs, ci, etc.)

Omit empty sections. Format each entry as a bullet with the commit hash linked to GitHub:

```
* **scope:** description ([short-hash](https://github.com/nuasite/nuasite/commit/<full-hash>))
```

Present the release notes to the user for review and allow them to edit.

### 5. Bump the version

Use the Edit tool to update the `version` field in **all 8 package.json files**:

1. `package.json` (root)
2. `packages/agent-summary/package.json`
3. `packages/cli/package.json`
4. `packages/cms/package.json`
5. `packages/components/package.json`
6. `packages/core/package.json`
7. `packages/llm-enhancements/package.json`
8. `packages/nua/package.json`

### 6. Update the lockfile

Run `bun install` to regenerate `bun.lock` with the new versions.

### 7. Update CHANGELOG.md

Read the current `CHANGELOG.md` and prepend a new entry at the top (after the `# Changelog` heading) in this format:

```markdown
## [<new-version>](https://github.com/nuasite/nuasite/compare/v<old-version>...v<new-version>) (<YYYY-MM-DD>)

### Features

- **scope:** description ([hash](url))

### Bug Fixes

- **scope:** description ([hash](url))
```

Match the existing style in the file. Omit empty sections.

### 8. Commit, tag, and push

```bash
git add package.json packages/*/package.json bun.lock CHANGELOG.md
git commit -m "release: v<new-version>"
git tag -a "v<new-version>" -m "v<new-version>"
git push origin main --follow-tags
```

### 9. Create GitHub release

Use `gh release create` with the generated release notes:

```bash
gh release create "v<new-version>" --title "v<new-version>" --notes "<release-notes>"
```

### 10. Summary

Tell the user:

- The new version number
- Link to the GitHub release
- That the publish workflow will run automatically (triggered by the tag push)
