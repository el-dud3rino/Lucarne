#!/usr/bin/env bash
# Launches Chromium in hardware-accelerated Wayland kiosk mode at 1920x1080
set -euo pipefail

# Wait up to 15s for local Lucarne server to listen on 3001
for _ in {1..30}; do
  if curl -sf http://127.0.0.1:3001/api/health >/dev/null; then
    break
  fi
  sleep 0.5
done

exec cage -s -- chromium \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --no-first-run \
  --ozone-platform=wayland \
  --enable-features=TouchpadOverscrollHistoryNavigation,UseOzonePlatform \
  --touch-events=enabled \
  --disable-pinch \
  --overscroll-history-navigation=0 \
  --check-for-update-interval=31536000 \
  "http://127.0.0.1:3001"
