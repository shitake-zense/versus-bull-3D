// Firebase 初期化。Realtime Database のみ使用。
// Web用Firebase configは「公開前提」の値（デプロイすれば必ずバンドルに含まれる公開情報）。
// そのためデプロイを確実にするためデフォルト値をコミットしている。
// 環境変数(VITE_FIREBASE_*)があればそちらを優先（ローカル開発や別プロジェクトへの差し替え用）。
// ※ 不正書き込みの防止は apiKey の秘匿ではなく Realtime Database のセキュリティルールで行う。

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';

// 公開プロジェクト versus-bull-3d の web 設定（公開情報）。
const DEFAULT_CONFIG = {
  apiKey: 'AIzaSyB5EuB95JYheC9EemO6dQVPqD76LL_W7W0',
  authDomain: 'versus-bull-3d.firebaseapp.com',
  databaseURL: 'https://versus-bull-3d-default-rtdb.firebaseio.com',
  projectId: 'versus-bull-3d',
  storageBucket: 'versus-bull-3d.firebasestorage.app',
  messagingSenderId: '359911210055',
  appId: '1:359911210055:web:20aefbcc535622e1bb0562',
};

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || DEFAULT_CONFIG.apiKey,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || DEFAULT_CONFIG.authDomain,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || DEFAULT_CONFIG.databaseURL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || DEFAULT_CONFIG.projectId,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || DEFAULT_CONFIG.storageBucket,
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || DEFAULT_CONFIG.messagingSenderId,
  appId: import.meta.env.VITE_FIREBASE_APP_ID || DEFAULT_CONFIG.appId,
};

/** 必須の env が揃っているか。未設定ならオンラインモードを無効化してUIで案内する。 */
export const isFirebaseConfigured = Boolean(config.databaseURL && config.apiKey);

let app: FirebaseApp | null = null;
let db: Database | null = null;

export function getDb(): Database {
  if (!isFirebaseConfigured) {
    throw new Error(
      'Firebase が未設定です。.env に VITE_FIREBASE_* を設定してください（README参照）。',
    );
  }
  if (!app) app = initializeApp(config);
  if (!db) db = getDatabase(app);
  return db;
}
