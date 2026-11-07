#!/bin/sh
# Prompts for an API key (hidden) and stores it in .env as $1, never echoed or committed.
#   sh scripts/add-key.sh ELEVENLABS_API_KEY
name="${1:?usage: add-key.sh VAR_NAME}"
cd "$(dirname "$0")/.." || exit 1
printf "Paste your %s (hidden), then Enter: " "$name"
stty -echo; read -r key; stty echo; echo
[ -n "$key" ] || { echo "Nothing entered."; exit 1; }
grep -v "^$name=" .env > .env.tmp 2>/dev/null; mv .env.tmp .env
printf '%s=%s\n' "$name" "$key" >> .env && chmod 600 .env
echo "Saved to .env. You can close this tab."
