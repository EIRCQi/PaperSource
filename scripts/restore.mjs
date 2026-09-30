import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {restoreBackup} from '../lib/archive.mjs';

const [source, destination]=process.argv.slice(2);
if (!source) {
  console.error('用法：npm run restore -- "备份文件夹路径" ["新的文献库目录"]\n恢复目录必须不存在；原文献库不会被覆盖。');
  process.exitCode=1;
} else {
  try {
    const result=await restoreBackup(source,destination||path.join(os.homedir(),'PaperDeskRestored-'+randomUUID().slice(0,8)));
    console.log(`已恢复 ${result.count} 篇文献。\n新文献库：${result.path}\n启动时将 PAPERDESK_DATA 环境变量设为上述路径，再运行 npm run open。\n原文献库和备份保持不变。`);
  } catch(error) {
    console.error(error.code==='EEXIST'?'恢复目录已存在，请选择一个新目录。':`恢复失败：${error.message}`);
    process.exitCode=1;
  }
}
