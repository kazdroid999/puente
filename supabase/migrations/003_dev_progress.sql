-- Punete Micro SaaS Store — Auto Dev 進捗表示用カラム
-- 開発中の「あと何%・約何分」をユーザーに見せる
--
-- dev_phase: 現在フェーズの日本語表示文字列（emoji 含む）
-- dev_started_at: 開発開始時刻（経過時間/残り時間計算用）
-- dev_progress: 0-100 の進捗パーセンテージ
--
-- 5 フェーズ:
--   5%  「📋 企画を整理中」(開始)
--   25% 「🎨 画面の構成を考え中」(generateAppConfig 完了後)
--   50% 「⚙️ アプリを組み立て中」(saas_apps 作成後)
--   80% 「🚀 デプロイ準備中」(DNS+Stripe 後)
--  100% 「✅ 完成しました ☕️」(全完了)

ALTER TABLE saas_projects
  ADD COLUMN IF NOT EXISTS dev_phase TEXT,
  ADD COLUMN IF NOT EXISTS dev_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS dev_progress SMALLINT DEFAULT 0;

COMMENT ON COLUMN saas_projects.dev_phase IS 'Auto-dev 現在フェーズの日本語表示（emoji含む）';
COMMENT ON COLUMN saas_projects.dev_started_at IS 'Auto-dev 開始時刻（経過時間計算用）';
COMMENT ON COLUMN saas_projects.dev_progress IS 'Auto-dev 進捗 0-100';
