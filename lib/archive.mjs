import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {validateRules} from './classify.mjs';

export function validateCatalog(db) {
  if (!db || db.version !== 1 || !Array.isArray(db.papers)) throw Error('书目格式无效');
  if(db.classification!==undefined){const c=db.classification;if(!c||!Number.isSafeInteger(c.revision)||c.revision<0||typeof c.autoOnImport!=='boolean')throw Error('分类设置无效');validateRules(c.rules);}
  const ids = new Set(), hashes = new Set();
  for (const p of db.papers) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || typeof p.hash !== 'string' || !/^[a-f0-9-]{36}$/.test(p.id) || !/^[a-f0-9]{64}$/.test(p.hash)) throw Error('文献标识无效');
    if (ids.has(p.id) || hashes.has(p.hash)) throw Error('书目包含重复记录');
    ids.add(p.id); hashes.add(p.hash);
    for (const key of ['title', 'filename', 'authors', 'year', 'doi', 'journal', 'notes', 'createdAt']) {
      if (typeof p[key] !== 'string' || p[key].length > (key === 'notes' ? 100000 : 2000)) throw Error('文献字段无效：' + key);
    }
    if (!p.title.length || !Number.isSafeInteger(p.size) || p.size < 1 || !Number.isFinite(Date.parse(p.createdAt))) throw Error('文献记录无效');
    if (!Array.isArray(p.tags) || p.tags.length > 50 || p.tags.some(t => typeof t !== 'string' || t.length > 80)) throw Error('文献标签无效');
    if (!['unread', 'reading', 'done'].includes(p.status) || typeof p.trashed !== 'boolean' || typeof p.favorite !== 'boolean') throw Error('文献状态无效');
    if (p.revision !== undefined && (!Number.isSafeInteger(p.revision) || p.revision < 0)) throw Error('文献版本无效');
  }
  return db;
}

async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

async function copyVerified(source, target, paper) {
  const stat = await fs.lstat(source);
  if (!stat.isFile() || stat.size !== paper.size) throw Error('PDF 缺失或大小异常：' + paper.filename);
  await fs.copyFile(source, target);
  await fs.chmod(target, 0o600);
  if (await hashFile(target) !== paper.hash) throw Error('PDF 内容校验失败：' + paper.filename);
}

export async function createBackup(dataPath, snapshot) {
  // Serialize now: later edits must not alter the snapshot used during the copy.
  const catalogText = JSON.stringify(validateCatalog(snapshot), null, 2);
  const catalog = JSON.parse(catalogText);
  const backups = path.join(dataPath, 'backups');
  await fs.mkdir(backups, {recursive:true, mode:0o700});
  const stamp = new Date().toISOString();
  const name = 'backup-' + stamp.replace(/[:.]/g, '-') + '-' + randomUUID().slice(0, 8);
  const staging = path.join(backups, '.partial-' + randomUUID());
  const destination = path.join(backups, name);
  await fs.mkdir(path.join(staging, 'files'), {recursive:true, mode:0o700});
  try {
    for (const paper of catalog.papers) await copyVerified(path.join(dataPath, 'files', paper.hash + '.pdf'), path.join(staging, 'files', paper.hash + '.pdf'), paper);
    await fs.writeFile(path.join(staging, 'catalog.json'), catalogText, {mode:0o600});
    const manifest = {format:'paperdesk-backup', version:1, createdAt:stamp, count:catalog.papers.length, bytes:catalog.papers.reduce((n,p)=>n+p.size,0), catalogHash:createHash('sha256').update(catalogText).digest('hex')};
    await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), {mode:0o600});
    await fs.rename(staging, destination);
    return {path:destination, ...manifest};
  } catch (error) {
    await fs.rm(staging, {recursive:true, force:true}).catch(()=>{});
    throw error;
  }
}

export async function restoreBackup(source, destination) {
  source=path.resolve(source); destination=path.resolve(destination);
  const manifest=JSON.parse(await fs.readFile(path.join(source,'manifest.json'),'utf8'));
  const catalogBytes=await fs.readFile(path.join(source,'catalog.json'));
  if (manifest.format!=='paperdesk-backup' || manifest.version!==1 || manifest.catalogHash!==createHash('sha256').update(catalogBytes).digest('hex')) throw Error('备份题录校验失败，未执行恢复');
  const catalog=validateCatalog(JSON.parse(catalogBytes.toString('utf8')));
  if (manifest.count!==catalog.papers.length || manifest.bytes!==catalog.papers.reduce((n,p)=>n+p.size,0)) throw Error('备份清单不完整');
  // mkdir without recursive prevents replacement of any existing directory.
  await fs.mkdir(destination, {mode:0o700});
  try {
    await fs.writeFile(path.join(destination,'running.lock'),String(process.pid),{flag:'wx',mode:0o600});
    await fs.mkdir(path.join(destination,'files'), {mode:0o700});
    for (const p of catalog.papers) await copyVerified(path.join(source,'files',p.hash+'.pdf'),path.join(destination,'files',p.hash+'.pdf'),p);
    await fs.writeFile(path.join(destination,'catalog.json'),catalogBytes,{mode:0o600});
    await fs.unlink(path.join(destination,'running.lock'));
    return {path:destination,count:catalog.papers.length};
  } catch(error) {
    await fs.rm(destination,{recursive:true,force:true}).catch(()=>{});
    throw error;
  }
}
