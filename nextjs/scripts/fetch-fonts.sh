#!/usr/bin/env bash
# Re-download the self-hosted Nunito and Quicksand woff2 files (issue #633,
# PR #634) and verify each against its known-good sha256, so the committed
# files under src/app/fonts/ are reproducible instead of resting on prose.
#
# The two woff2 files come from the "latin" @font-face block that
# fonts.googleapis.com/css2 serves for a Chrome-class User-Agent (a plainer
# UA, or omitting the weight-range syntax, gets served static TTFs instead
# of the variable woff2 — that's why the UA below is pinned, not decorative).
#
# Usage:
#   scripts/fetch-fonts.sh          # verify committed files match, no writes
#   scripts/fetch-fonts.sh --write  # also overwrite the committed files
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
FONTS_DIR="$ROOT/src/app/fonts"
UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
WRITE=0
[ "${1:-}" = "--write" ] && WRITE=1

# name | css2 request URL | expected gstatic URL | dest path | sha256
FONTS=(
  "Nunito|https://fonts.googleapis.com/css2?family=Nunito:ital,wght@0,200..1000;1,200..1000&display=swap|https://fonts.gstatic.com/s/nunito/v32/XRXV3I6Li01BKofINeaB.woff2|$FONTS_DIR/nunito/Nunito-Variable.woff2|ba344451eab25b217a165363b1982048a5e5830a0daf36577973955a04cac793"
  "Quicksand|https://fonts.googleapis.com/css2?family=Quicksand:wght@300..700&display=swap|https://fonts.gstatic.com/s/quicksand/v37/6xKtdSZaM9iE8KbpRA_hK1QN.woff2|$FONTS_DIR/quicksand/Quicksand-Variable.woff2|2add7d60b1cd2ab84c9967e23d5ec08eb3fc9635c46855b17d59404dec6b410e"
)

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

status=0
for entry in "${FONTS[@]}"; do
  IFS='|' read -r name css2_url gstatic_url dest expected_sha <<<"$entry"

  # Confirm the css2 API still points at the gstatic URL we expect, so a
  # future Google Fonts re-build (a new "v33") is caught rather than silently
  # re-downloading something else under the same file name. The css2
  # response lists subsets in a fixed order (…, latin-ext, latin) with the
  # italic group first and the normal group last, so the *last* "/* latin */"
  # marker in the file always starts the one normal-style latin @font-face
  # block, with nothing after it — no need to disambiguate from other
  # subsets' "font-style: normal" lines.
  # Every step below is allowed to find nothing (`|| true`): under
  # `set -euo pipefail`, an empty `grep` match would otherwise abort the
  # script right here, before the mismatch branch below ever gets to print
  # its message — silent failure instead of a loud, actionable one.
  css_body=$(curl -fsS -A "$UA" "$css2_url")
  last_latin_line=$(printf '%s\n' "$css_body" | grep -n '/\* latin \*/' | tail -1 | cut -d: -f1 || true)
  actual_gstatic_url=""
  if [ -n "$last_latin_line" ]; then
    actual_gstatic_url=$(printf '%s\n' "$css_body" \
      | sed -n "${last_latin_line},\$p" \
      | grep -o 'https://fonts\.gstatic\.com/[^)]*' || true)
  fi

  if [ "$actual_gstatic_url" != "$gstatic_url" ]; then
    echo "$name: css2 API now serves a different latin URL." >&2
    echo "  expected: $gstatic_url" >&2
    echo "  actual:   ${actual_gstatic_url:-<none found>}" >&2
    echo "  Font was likely rebuilt upstream — re-verify glyph coverage before updating the pin." >&2
    status=1
    continue
  fi

  tmp=$(mktemp)
  trap 'rm -f "$tmp"' EXIT
  curl -fsS -A "$UA" -o "$tmp" "$gstatic_url"
  actual_sha=$(sha256_of "$tmp")

  if [ "$actual_sha" != "$expected_sha" ]; then
    echo "$name: sha256 MISMATCH" >&2
    echo "  expected: $expected_sha" >&2
    echo "  actual:   $actual_sha" >&2
    status=1
    rm -f "$tmp"
    continue
  fi

  echo "$name: OK ($actual_sha)"
  if [ "$WRITE" = 1 ]; then
    mkdir -p "$(dirname "$dest")"
    mv "$tmp" "$dest"
  else
    rm -f "$tmp"
  fi
done

exit $status
