# Pavo learnings

レビューのやり取りから蓄積された、このリポジトリ固有の方針メモ。

- 2026-07-17 (#14): reusable workflow (workflow_call) の caller 側には permissions ブロックを足さない方針。呼び出し先 job の宣言でキャップされ、caller 側の付与は反映されず dead config になるため。今後同パターンを見たら指摘に反映する。
