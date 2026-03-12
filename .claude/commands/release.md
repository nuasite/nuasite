Release a new version of packages.

## Instructions

Follow these steps exactly:

### 1. Determine the version bump

Find the last release tag and show changes since then:

```bash
git describe --tags --abbrev=0
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

Analyze the changes and determine the version bump type:

- **MAJOR** (x.0.0): Breaking changes, incompatible API changes
- **MINOR** (0.x.0): New features, functionality additions (backwards compatible)
- **PATCH** (0.0.x): Bug fixes, small improvements, refactoring

Read the current version from `package.json` and calculate the new version.

Present your recommendation to the user for confirmation. If the user provided arguments (e.g. `/release patch`, `/release 0.3.0`), use that instead.

### 2. Generate changelog entry

Group the commits since the last tag into sections based on conventional commit prefixes:

- **Features** — `feat:` or `feat(...):` commits
- **Bug Fixes** — `fix:` or `fix(...):` commits
- **Other Changes** — everything else (refactor, chore, style, docs, ci, etc.)

Omit empty sections. Format each entry as a bullet with the commit hash linked to GitHub:

```
* **scope:** description ([short-hash](https://github.com/nuasite/nuasite/commit/<full-hash>))
```

Present the release notes to the user for review and allow them to edit.

### 3. Update CHANGELOG.md

Read the current `CHANGELOG.md` and prepend a new entry at the top (after the `# Changelog` heading) in this format:

```markdown
## [<new-version>](https://github.com/nuasite/nuasite/compare/v<old-version>...v<new-version>) (<YYYY-MM-DD>)

### Features

- **scope:** description ([hash](url))

### Bug Fixes

- **scope:** description ([hash](url))
```

Match the existing style in the file. Omit empty sections.

### 4. Commit the changelog and run the release script

```bash
git add CHANGELOG.md
git commit -m "changelog: v<new-version>"
```

Then run the tag-version script which handles everything else (preflight checks, version bump in all package.json files, lockfile update, commit, tag, and push):

```bash
./scripts/tag-version/run.sh <new-version>
```

### 5. Create GitHub release

```bash
gh release create "v<new-version>" --title "v<new-version>" --notes "<release-notes>"
```

### 6. Summary

Tell the user:

- The new version number
- Link to the GitHub release
- That the publish workflow will run automatically (triggered by the tag push)
