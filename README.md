# 商談実施〜案件化 管理体制 自動化

商談獲得〜初回商談判定〜結果報告〜各シートへの転記〜NA日追いかけまでを、
Slack Workflow Builder + Google Apps Script で自動化するための設計・実装一式。

- 設計の全体像・フロー図・シート設計: [docs/workflow-design.md](docs/workflow-design.md)
- GAS 実装: [gas/](gas/)

## 導入チェックリスト（マイルストーン①〜⑧）

番号は [docs/workflow-design.md](docs/workflow-design.md) §8 のマイルストーン・スケジュール表と対応。

- [x] ①`Jicoo対象リスト` を作成する（大さん保有分を転記）
- [x] ②初回商談一覧・追いかけ中商談リスト・失注リスト・突合のシート構成を更新する（列は docs/workflow-design.md §5 参照。`案件リスト`への列追加は不要。`追いかけ中商談リスト`・`失注リスト`はKPI管理シート側に作成）
- [x] ③`CalendarFetch.gs` を配置する（既存の `syncCalendarToSheet` の走査パターンをベースに、Jicoo対象リスト／記名ルールで初回判定するよう改造。既存スクリプトの `カレンダー情報_raw` 転記は変更なし）
- [x] ④Incoming Webhook URLを確認する（発行済み）
- [ ] ⑤Slack Workflow Builder を設定する：新規に「進行中」「失注」の2ワークフローを作成（既存の「案件化」ワークフローは変更不要になった。NA日フィールド必須。企業名等はSlack通知本文からコピペで手入力。docs/workflow-design.md §6 の手順）
- [x] ⑥`gas/` の各ファイルを Apps Script プロジェクトにコピーし、スクリプトプロパティを設定。`collectFirstMeetings` / `notifyCompletedFirstMeetings` / `renotifyDueFollowUps` / `reconcileDealSheetWrites` の4つの時間主導トリガーを設定（Web Appのデプロイは不要）
- [ ] ⑦ダミーデータで初回ループ・NA日再通知ループの両方をE2Eテストする（実企業名は使わない）
- [ ] ⑧チームへ共有・運用開始を案内

## 注意事項

- 実在の顧客名・担当者名・連絡先・金額は、このディレクトリ配下のファイルに書き込まないこと。
- テスト時もダミーデータ（例: 株式会社サンプル / 山田太郎 / sample@example.invalid）を使用する。
- `gas/` 配下のファイルは、既存の `syncCalendarToSheet` 等が入っている同じApps Scriptプロジェクトに
  追加する想定。トップレベルの変数・関数名が衝突しないよう命名しているが、追加時は一度確認すること。
- Slackワークフローのリンクトリガーにカスタム変数を渡せないため、GASと商談DBの突き合わせは
  企業名（一致しなければ商談実施日＋候補1件のみ）で行う。同一企業名の商談が同時に複数
  未回答の場合は自動マッチしない（docs/workflow-design.md §9 参照）。
