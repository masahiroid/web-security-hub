#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
bash scripts/bootstrap/start.sh "$@"
STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo "起動に失敗しました。上の内容を確認してください。 / Could not start. See the error above."
  read -r -p "Enter で閉じます / Press Enter to close… " _
fi
exit "$STATUS"
