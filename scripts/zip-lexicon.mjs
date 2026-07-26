import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const sqlitePath = path.resolve('apps/nuxt/public/typewords_lexicon_v2/lexicon.sqlite');
const zipPath = path.resolve('apps/nuxt/public/typewords_lexicon_v2/lexicon.sqlite.zip');

if (fs.existsSync(sqlitePath)) {
  const sqliteStat = fs.statSync(sqlitePath);
  const zipStat = fs.existsSync(zipPath) ? fs.statSync(zipPath) : null;

  if (!zipStat || sqliteStat.mtimeMs > zipStat.mtimeMs) {
    console.log('[zip-lexicon] 检测到 lexicon.sqlite 已更新，正在打包为 lexicon.sqlite.zip ...');
    if (process.platform === 'win32') {
      execSync(`powershell -Command "Compress-Archive -Path '${sqlitePath}' -DestinationPath '${zipPath}' -Force"`, { stdio: 'inherit' });
    } else {
      execSync(`zip -j -o "${zipPath}" "${sqlitePath}"`, { stdio: 'inherit' });
    }
    console.log('[zip-lexicon] 打包完成！');
    try {
      execSync(`git add "${zipPath}"`);
      console.log('[zip-lexicon] 已自动将最新 lexicon.sqlite.zip 加入 git 暂存区。');
    } catch (e) {
      // ignore
    }
  }
}
