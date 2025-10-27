#!/bin/bash
set -e

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to publish packages" >&2
  exit 1
fi

run_script_if_present() {
  local script="$1"

  if jq -e ".scripts // {} | has(\"${script}\")" package.json >/dev/null 2>&1; then
    bun run "$script"
  fi
}

for dir in packages/*; do
  if [ -f "$dir/package.json" ]; then
    (
      cd "$dir"

      if jq -e '.private == true' package.json >/dev/null 2>&1; then
        exit 0
      fi

      run_script_if_present prepack
      run_script_if_present build

      set +e
      npm publish --tag "$NPM_TAG" --provenance --access public
      publish_status=$?
      set -e

      run_script_if_present postpack

      if [ "$publish_status" -ne 0 ]; then
        exit "$publish_status"
      fi
    )
  fi
done
