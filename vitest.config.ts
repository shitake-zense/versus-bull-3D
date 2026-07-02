import { defineConfig } from 'vitest/config';

// 純ロジック（src/lib）の単体テスト専用。既存の vite.config.ts（本番ビルド設定）には触れない。
// node 環境で完結する決定的テストのみを対象にする。
export default defineConfig({
  test: {
    include: ['src/lib/**/*.test.ts'],
    environment: 'node',
  },
});
