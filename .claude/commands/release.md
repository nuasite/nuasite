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

### 2. Generate release notes

Group the commits since the last tag into sections based on conventional commit prefixes:

- **Features** — `feat:` or `feat(...):` commits
- **Bug Fixes** — `fix:` or `fix(...):` commits
- **Other Changes** — everything else (refactor, chore, style, docs, ci, etc.)

Omit empty sections. Format each entry as a bullet with the commit hash linked to GitHub:

```
* **scope:** description ([short-hash](https://github.com/nuasite/nuasite/commit/<full-hash>))
```

Present the release notes to the user for review and allow them to edit.

### 3. Run the release script

Run the tag-version script which handles everything (preflight checks, version bump in all package.json files, lockfile update, commit, tag, and push):

```bash
./scripts/tag-version/run.sh <new-version>
```

### 4. Create GitHub release

```bash
gh release create "v<new-version>" --title "v<new-version>" --notes "<release-notes>"
```

### 5. Summary

Tell the user:

- The new version number
- Link to the GitHub release
- That the publish workflow will run automatically (triggered by the tag push)
