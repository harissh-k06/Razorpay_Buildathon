#!/usr/bin/env bash
# Generic branch synchronization script: Mirrors SOURCE_BRANCH into TARGET_BRANCH
set -euo pipefail

SOURCE_BRANCH="${1:-master}"
TARGET_BRANCH="${2:-main}"
REMOTE="${3:-origin}"
PUSH="${4:-true}"

echo "=== Generic Branch Sync: ${SOURCE_BRANCH} -> ${TARGET_BRANCH} ==="

CURRENT_BRANCH=$(git branch --show-current)
echo "Current active branch: ${CURRENT_BRANCH}"

STASHED=false
if [[ -n $(git status --porcelain) ]]; then
  echo "Working directory has changes. Stashing before sync..."
  git stash push -u -m "pre-sync-auto-stash"
  STASHED=true
fi

cleanup() {
  echo "Switching back to original branch: ${CURRENT_BRANCH}..."
  git checkout "${CURRENT_BRANCH}"
  if [[ "${STASHED}" == "true" ]]; then
    echo "Restoring stashed changes..."
    git stash pop --index || true
  fi
}
trap cleanup EXIT

echo "Fetching ${REMOTE}/${SOURCE_BRANCH}..."
git fetch "${REMOTE}" "${SOURCE_BRANCH}"

echo "Checking out ${TARGET_BRANCH} and resetting hard to ${SOURCE_BRANCH}..."
git checkout -B "${TARGET_BRANCH}" "${SOURCE_BRANCH}"

if [[ "${PUSH}" == "true" ]]; then
  echo "Pushing exact copy of ${SOURCE_BRANCH} to ${REMOTE}/${TARGET_BRANCH}..."
  git push "${REMOTE}" "${TARGET_BRANCH}:${TARGET_BRANCH}" --force
  echo "Successfully pushed ${TARGET_BRANCH} to ${REMOTE}!"
fi

echo "=== Sync complete: ${TARGET_BRANCH} is now an exact copy of ${SOURCE_BRANCH} ==="
