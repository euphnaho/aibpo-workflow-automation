# 商談実施〜案件化 管理体制 自動化

商談実施後の結果報告〜各シートへの転記を、Slack Workflow Builder + Google Apps Script で自動化するための設計・実装一式。

- 設計の全体像・フロー図・シート設計: [docs/workflow-design.md](docs/workflow-design.md)
- GAS 実装: [gas/](gas/)

## 導入チェックリスト

- [ ] `初回商談一覧` シートに紐付け用列を追加（`カレンダーID(紐付け用)` / `通知済みフラグ` / `Slackメッセージts` / `回答日時`）
- [ ] 案件管理シートに `案件化中商談一覧` / `失注リスト` シートを新規作成（列は docs/workflow-design.md §4.2, 4.3 参照）
- [ ] Slack Bot を作成し `chat:write` スコープを付与、対象チャンネルに招待
- [ ] Slack Workflow Builder で「商談結果報告」ワークフローを作成（docs/workflow-design.md §5 の手順）
- [ ] `gas/` の各ファイルを Apps Script プロジェクトにコピーし、スクリプトプロパティを設定
- [ ] Web App としてデプロイし、`/exec` URL を Slack ワークフローの Web リクエストステップに設定
- [ ] `notifyCompletedFirstMeetings` に時間主導トリガー（15分おき目安）を設定
- [ ] ダミーデータでテスト実施（実企業名は使わない）

## 注意事項

- 実在の顧客名・担当者名・連絡先・金額は、このディレクトリ配下のファイルに書き込まないこと。
- テスト時もダミーデータ（例: 株式会社サンプル / 山田太郎 / sample@example.invalid）を使用する。
