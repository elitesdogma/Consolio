#!/usr/bin/env bash
#
# deploy.sh — apply a Consolio update zip, verify it builds, then commit + push.
#
# Usage:
#   ./deploy.sh <path-to-consolio_vN.zip> ["commit message"]
#
# Run it from anywhere inside your Consolio git repo. It will:
#   1. extract the zip's files over the repo (preserving paths),
#   2. run `npm run build` as a gate — nothing is committed if it fails,
#   3. show you exactly what changed,
#   4. ask before committing and pushing (Railway auto-deploys on push).
#
# Written for macOS's default bash 3.2; no GNU-only features.

set -euo pipefail

ZIP="${1:-}"
MSG="${2:-Apply Consolio update}"

[ -n "$ZIP" ] || { echo "usage: ./deploy.sh <consolio_vN.zip> [\"commit message\"]"; exit 1; }
[ -f "$ZIP" ] || { echo "error: zip not found: $ZIP"; exit 1; }

# Resolve the zip to an absolute path before we change directory.
ZIP_ABS="$(cd "$(dirname "$ZIP")" && pwd)/$(basename "$ZIP")"

# Must be inside the git repo.
git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
  || { echo "error: run this from inside your Consolio git repo"; exit 1; }
REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"
[ -f package.json ] || { echo "error: no package.json at repo root ($REPO_ROOT)"; exit 1; }

echo "Repo:    $REPO_ROOT"
echo "Update:  $ZIP_ABS"

# Extract to a temp dir so we can see the file list before touching the repo.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
unzip -oq "$ZIP_ABS" -d "$TMP"

# Collect the files (relative paths), skipping directories.
FILES=()
while IFS= read -r f; do
  FILES+=("${f#"$TMP"/}")
done < <(find "$TMP" -type f)

[ "${#FILES[@]}" -gt 0 ] || { echo "error: the zip contained no files"; exit 1; }

echo
echo "Files in this update:"
printf '  %s\n' "${FILES[@]}"

echo
echo "Applying files..."
for rel in "${FILES[@]}"; do
  mkdir -p "$(dirname "$rel")"
  cp "$TMP/$rel" "$rel"
done

# Make sure dependencies exist, then build. This is the validation step
# that catches a JSX/compile error before it ever reaches a commit.
if [ ! -d node_modules ]; then
  echo
  echo "Installing dependencies (first run only)..."
  npm install
fi

echo
echo "Building to verify it compiles..."
if ! npm run build; then
  echo
  echo "BUILD FAILED — nothing has been committed."
  echo "Fix the error shown above, or discard the applied files and return to your last commit with:"
  echo "  git checkout -- ${FILES[*]}"
  echo "  # then delete any brand-new files the update added (e.g. a CHANGELOG_*.md) if you don't want them"
  exit 1
fi

# Stage exactly the files from the zip (so unrelated work and build artifacts
# in dist/ are never swept in).
git add -- "${FILES[@]}"

if git diff --cached --quiet; then
  echo
  echo "Applied files are identical to what's already committed. Nothing to deploy."
  exit 0
fi

echo
echo "Build OK. Changes to be committed:"
git --no-pager diff --cached --stat

echo
printf "Commit and push to deploy? [y/N] "
read -r ANS
case "$ANS" in
  y|Y|yes|YES)
    git commit -m "$MSG"
    git push
    echo
    echo "Pushed. Railway will build and deploy from this commit."
    echo "If that build fails on Railway, the currently running version keeps serving — nothing goes down."
    echo
    echo "Confirm once live:"
    echo "  1. Footer/version shows the new number."
    echo "  2. Two-tab conflict test: load in tabs A and B, save an edit in A, then edit + save in B -> B shows the conflict bar."
    ;;
  *)
    echo "Left staged, not pushed. When ready:"
    echo "  git commit -m \"$MSG\" && git push"
    ;;
esac
