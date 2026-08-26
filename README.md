# 商談実施〜案件化 管理体制 自動化

商談獲得〜初回商談判定〜結果報告〜各シートへの転記〜NA日追いかけまでを、
Slack Workflow Builder + Google Apps Script で自動化するための設計・実装一式。

- 設計の全体像・フロー図・シート設計: [docs/workflow-design.md](docs/workflow-design.md)
- GAS 実装: [gas/](gas/)

## 導入チェックリスト（マイルストーン①〜⑧）

番号は [docs/workflow-design.md](docs/workflow-design.md) §8 のマイルストーン・スケジュール表と対応。

- [ ] ①`Jicoo対象リスト` を作成する（大さん保有分を転記）
- [ ] ②初回商談一覧・追いかけ中商談リスト・失注リストのシート構成を更新する（列は docs/workflow-design.md §5 参照）
- [ ] ③`CalendarFetch.gs` を配置し、Jicoo判定条件（説明欄/場所欄に "jicoo" を含むか）を実データで検証・調整する
- [ ] ④Slack Bot を作成し `chat:write` スコープを付与、対象チャンネルに招待
- [ ] ⑤Slack Workflow Builder で「商談結果報告」ワークフローを作成（NA日フィールド必須。docs/workflow-design.md §6 の手順）
- [ ] ⑥`gas/` の各ファイルを Apps Script プロジェクトにコピーし、スクリプトプロパティを設定。Web App としてデプロイし、`collectFirstMeetings` / `notifyCompletedFirstMeetings` / `renotifyDueFollowUps` の3つの時間主導トリガーを設定
- [ ] ⑦ダミーデータで初回ループ・NA日再通知ループの両方をE2Eテストする（実企業名は使わない）
- [ ] ⑧チームへ共有・運用開始を案内

## 注意事項

- 実在の顧客名・担当者名・連絡先・金額は、このディレクトリ配下のファイルに書き込まないこと。
- テスト時もダミーデータ（例: 株式会社サンプル / 山田太郎 / sample@example.invalid）を使用する。
