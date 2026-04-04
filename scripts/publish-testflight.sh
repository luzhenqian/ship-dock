#!/bin/bash
# YiOne Test Build Publishing Script
# Usage:
#   ./scripts/publish-testflight.sh          # Build both iOS + Android
#   ./scripts/publish-testflight.sh ios      # iOS only (TestFlight)
#   ./scripts/publish-testflight.sh android  # Android only (APK download link)
set -euo pipefail

PLATFORM="${1:-all}"
MOBILE_DIR="$(cd "$(dirname "$0")/../apps/mobile" && pwd)"
ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo ""
echo "=============================="
echo "  YiOne Test Build Publish"
echo "  Platform: ${PLATFORM}"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================="

# ── 1. Build workspace packages ──
echo ""
echo ">> Building workspace packages ..."
cd "$ROOT_DIR"
pnpm turbo build --filter=@yione/types --filter=@yione/utils --filter=@yione/api-client

# ── 2. Update dist files in git ──
echo ""
echo ">> Committing latest changes ..."
cd "$ROOT_DIR"
git add -f packages/types/dist/ packages/utils/dist/ packages/api-client/dist/
git add -A apps/mobile/ pnpm-lock.yaml
if git diff --cached --quiet; then
  echo "  No changes to commit"
else
  git commit -m "chore: update for test build $(date '+%Y%m%d-%H%M')"
  echo "  Changes committed"
fi

# ── 3. Build iOS (TestFlight) ──
if [[ "$PLATFORM" == "all" || "$PLATFORM" == "ios" ]]; then
  echo ""
  echo ">> Building iOS + Submit to TestFlight ..."
  cd "$MOBILE_DIR"
  eas build --platform ios --profile production --auto-submit --non-interactive
  echo ""
  echo "  iOS: https://appstoreconnect.apple.com/apps/6761611173/testflight/ios"
fi

# ── 4. Build Android (APK) ──
if [[ "$PLATFORM" == "all" || "$PLATFORM" == "android" ]]; then
  echo ""
  echo ">> Building Android APK ..."
  cd "$MOBILE_DIR"
  eas build --platform android --profile preview --non-interactive
  echo ""
  echo "  Android APK download link is shown above."
  echo "  Share the link with your team — they can install it directly."
fi

echo ""
echo "=============================="
echo "  Publish Complete!"
echo "  $(date '+%Y-%m-%d %H:%M:%S')"
echo "=============================="
