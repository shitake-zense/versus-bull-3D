// Firebase 初期化。Realtime Database のみ使用。
// 設定値は .env（VITE_ prefix）から読む。Web用Firebase configは公開前提の値なので
// バンドルへ焼き込まれても問題ない（書き込み制御は DB セキュリティルールで行う）。

import { initializeApp, type FirebaseApp } from 'firebase/app';
import { getDatabase, type Database } from 'firebase/database';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
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
