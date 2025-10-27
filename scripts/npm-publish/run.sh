#!/bin/bash
set -e

log() {
  printf '[%s] %s\n' "$1" "$2"
}

log_info() {
  log INFO "$*"
}

log_error() {
  log ERROR "$*"
}

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required to publish packages" >&2
  exit 1
fi

run_script_if_present() {
  local script="$1"
  local pkg_label="$2"

  if jq -e ".scripts // {} | has(\"${script}\")" package.json >/dev/null 2>&1; then
    log_info "$pkg_label: running script '$script'"
    bun run "$script"
  else
    log_info "$pkg_label: skipping script '$script' (not defined)"
  fi
}

log_info "Scanning packages directory"

for dir in packages/*; do
  if [ -f "$dir/package.json" ]; then
    (
      cd "$dir"

      package_label=$(jq -r '.name // empty' package.json 2>/dev/null)
      if [ -z "$package_label" ]; then
        package_label="${dir#packages/}"
      fi

      log_info "$package_label: preparing to publish"

      if jq -e '.private == true' package.json >/dev/null 2>&1; then
        log_info "$package_label: package marked private, skipping"
        exit 0
      fi

      publish_tag="${NPM_TAG:-latest}"
      log_info "$package_label: publishing with tag '$publish_tag'"
      set +e
      npm publish --tag "$publish_tag" --provenance --access public
      publish_status=$?
      set -e

      if [ "$publish_status" -ne 0 ]; then
        log_error "$package_label: publish failed with exit code $publish_status"
        exit "$publish_status"
      fi

      log_info "$package_label: publish succeeded"
      log_info ""
      log_info ""
    )
  fi
done
