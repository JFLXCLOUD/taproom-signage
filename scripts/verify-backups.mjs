// Two isolated servers: a backup must restore completely on an empty machine.
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const servers = [], dirs = [], cookies = [];
let browser;
const base = i => `http://127.0.0.1:${18210+i}`;
async function request(i, route, body, method = 'POST', expected = 200) {
  const res = await fetch(base(i)+route, { method, headers: { 'Content-Type': 'application/json', ...(cookies[i] ? { Cookie: cookies[i] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.equal(res.status, expected, await res.clone().text());
  return res.json();
}
const state = i => request(i, '/api/state', undefined, 'GET');
const exportFrom = i => request(i, '/api/export', undefined, 'GET');
const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
try {
  for (let i = 0; i < 2; i++) {
    dirs[i] = mkdtempSync(path.join(tmpdir(), 'taproom-backup-'));
    const child = spawn(process.execPath, ['src/server.js'], { windowsHide: true, env: { ...process.env, DATA_DIR: dirs[i], PORT: String(18210+i), HOST: '127.0.0.1', DISCOVERY: '0', SEED_DEMO: '0', ADMIN_PASSWORD: 'backup-test', TZ: i ? 'UTC' : 'America/New_York' }, stdio: ['ignore','pipe','pipe'] });
    servers.push(child);
    let log = ''; child.stdout.on('data', b => log += b); child.stderr.on('data', b => log += b);
    for (let n=0; n<100 && !log.includes(`localhost:${18210+i}/`); n++) { if(child.exitCode!==null) throw Error(log); await delay(100); }
    assert.ok(log.includes(`localhost:${18210+i}/`),log);
    await request(i, '/api/export', undefined, 'GET', 401);
    await request(i, '/api/import', {}, 'POST', 401);
    const login=await fetch(base(i)+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:'backup-test'})});
    cookies[i]=login.headers.get('set-cookie').split(';')[0];
  }
  const asset=await request(0,'/api/uploads',{dataUrl:image});
  await request(0,'/api/settings',{venue_name:'Source venue',logo:asset.id,theme:{preset:'bistro'},currency:'£'});
  const {board}=await request(0,'/api/boards',{name:'Drinks',ticker:'Welcome',theme:{showImages:true}});
  const section=(await state(0)).boards[0].sections[0];
  await request(0,`/api/sections/${section.id}/items`,{name:'Hidden draft',hidden:true,image:asset.id,abv:4.2,ibu:null,prices:[{label:'Pint',amount:'6.25'},{label:'Pitcher',amount:'21.00'}]});
  const {board:poster}=await request(0,'/api/boards',{name:'Poster',layout:'poster',content:{headline:'Music',body:'Tonight',image:asset.id,removeOn:'2030-12-01',overlay:0,showLogo:false}});
  const {playlist}=await request(0,'/api/playlists',{name:'Bar rotation'});
  await request(0,`/api/playlists/${playlist.id}/items`,{board_id:board.id,seconds:120});
  await request(0,`/api/playlists/${playlist.id}/items`,{board_id:poster.id,seconds:20});
  const {device}=await request(0,'/api/device/register',{});
  await request(0,'/api/devices/claim',{code:device.code,name:'Bar TV',playlist_id:playlist.id,orientation:'portrait'});
  const backup=await exportFrom(0);
  assert.equal(backup.version,2); assert.equal(backup.uploads.length,1);
  assert.ok(!('sessions' in backup));
  await request(1,'/api/settings',{venue_name:'Destination',theme:{preset:'coastal',bg:'#123456'}});
  const before=await state(1);
  const preview=await request(1,'/api/import',{...backup,mode:'replace',preview:true});
  assert.equal(preview.tvs,1); assert.equal(preview.images,1);
  assert.deepEqual(await state(1),before,'Preview cannot mutate');
  for (const corrupt of [
    {...backup,version:99},
    {...backup,uploads:[]},
    {...backup,uploads:[{...backup.uploads[0],id:'../outside.png'}]},
    {...backup,uploads:[{...backup.uploads[0],sha256:'bad'}]},
    {...backup,boards:[...backup.boards,backup.boards[0]]},
    {...backup,playlists:[{...backup.playlists[0],items:[{...backup.playlists[0].items[0],board_id:'missing'}]}]}
  ]) { await request(1,'/api/import',{...corrupt,mode:'replace'},'POST',400); assert.deepEqual(await state(1),before); }
  const testDb=new DatabaseSync(path.join(dirs[1],'signage.db'));
  testDb.exec("CREATE TRIGGER fail_restore BEFORE INSERT ON prices BEGIN SELECT RAISE(ABORT, 'forced rollback'); END;");
  await request(1,'/api/import',{...backup,mode:'replace'},'POST',500);
  assert.deepEqual(await state(1),before,'Failed transaction restores prior database');
  assert.deepEqual(readdirSync(path.join(dirs[1],'uploads')),[],'Failed transaction cleans new images');
  testDb.exec('DROP TRIGGER fail_restore'); testDb.close();
  await request(1,'/api/import',{...backup,mode:'replace',expectedRevision:preview.revision});
  const restored=await exportFrom(1);
  assert.deepEqual(restored.boards,backup.boards,'All content, IDs, prices, ordering, hidden items and expiry preserved');
  assert.deepEqual(restored.playlists,backup.playlists);
  assert.deepEqual(restored.devices.map(d=>({...d,last_seen:0})),backup.devices.map(d=>({...d,last_seen:0})));
  for(const field of ['venue_name','tagline','logo','currency','theme']) assert.deepEqual(restored.settings[field],backup.settings[field]);
  assert.deepEqual(restored.uploads,backup.uploads);
  const bytes=Buffer.from(await (await fetch(base(1)+'/u/'+asset.id)).arrayBuffer());
  assert.deepEqual(bytes,Buffer.from(backup.uploads[0].data,'base64'));
  const tv=await request(1,`/api/device/${device.id}/preview`,undefined,'GET');
  assert.equal(tv.paired,true); assert.equal(tv.scenes.length,2); assert.equal(tv.scenes[0].theme.orientation,'portrait');
  await request(1,'/api/import',{...backup,mode:'replace',expectedRevision:preview.revision},'POST',409);
  await request(1,'/api/import',{...backup,mode:'replace'});
  assert.deepEqual((await state(1)).boards,backup.boards,'Repeat replacement has no duplicate content');
  await request(1,'/api/import',{...backup,mode:'append'});
  const appended=await state(1);
  assert.equal(appended.boards.length,4); assert.equal(appended.playlists.length,2); assert.equal(appended.devices.length,1);
  const newRotation=appended.playlists.find(p=>p.id!==playlist.id);
  assert.ok(newRotation.items.every(scene=>!backup.boards.some(b=>b.id===scene.board_id)),'Append remaps rotation links');
  assert.equal(appended.settings.venue_name,'Source venue');
  const legacy={...backup,version:1}; delete legacy.uploads;
  const legacyPreview=await request(1,'/api/import',{...legacy,mode:'replace',preview:true});
  assert.ok(legacyPreview.warnings.length);
  await request(1,'/api/import',{...legacy,mode:'replace'});
  assert.deepEqual((await state(1)).boards,backup.boards,'Legacy backup retains poster data when images are already present');
  console.log('PASS: complete cross-server restore, images, poster expiry/timezone, rotations, TV IDs, settings, append remapping, legacy, validation, stale preview and rollback');
  if(process.env.PLAYWRIGHT_MODULE){
    const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE));
    browser=await chromium.launch({headless:true});
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base(1)); await page.locator('input[type=password]').fill('backup-test'); await page.getByRole('button',{name:'Sign in',exact:true}).click();
    await page.getByRole('heading',{name:'Your TVs',exact:true}).waitFor();
    await page.goto(base(1)+'/#settings');
    await page.getByText('App tools & backups',{exact:true}).click();
    const downloading=page.waitForEvent('download');
    await page.getByRole('button',{name:'Download backup',exact:true}).click();
    const download=await downloading;
    assert.equal(JSON.parse(readFileSync(await download.path(),'utf8')).uploads.length,1);
    await page.getByRole('button',{name:'Restore backup',exact:true}).click();
    const initial=(await state(1)).revision;
    await page.getByLabel('Backup file',{exact:true}).setInputFiles({name:'backup.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(backup))});
    await page.getByText('backup.json selected.',{exact:false}).waitFor();
    assert.equal((await state(1)).revision,initial,'Choosing a file cannot restore automatically');
    await page.getByLabel('Restore mode').selectOption('replace');
    await page.getByRole('button',{name:'Review backup',exact:true}).click();
    await page.getByRole('button',{name:'Restore now',exact:true}).click();
    assert.equal((await state(1)).revision,initial,'Replace requires confirmation');
    await page.getByText('Replace current menus, settings and TV assignments with this backup',{exact:true}).click();
    assert.equal(await page.getByRole('checkbox',{name:'Replace current menus, settings and TV assignments with this backup'}).isChecked(),true);
    await page.getByRole('button',{name:'Restore now',exact:true}).click();
    await page.getByRole('dialog').waitFor({state:'detached'});
    await page.reload();
    assert.deepEqual((await state(1)).boards,backup.boards);
    await page.getByText('App tools & backups',{exact:true}).click();
    await page.getByRole('button',{name:'Restore backup',exact:true}).click();
    await page.getByLabel('Backup file',{exact:true}).setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{bad')});
    await page.locator('.toast.err').waitFor();
    assert.equal(await page.getByRole('dialog').count(),1,'Failed restore keeps dialog open');
    assert.deepEqual(errors,[]);
    console.log('PASS: mobile download, choose/review/confirm/restore/reload, invalid file stays open; no browser errors');
  }
}finally{await browser?.close(); for(const child of servers)child.kill(); console.log('Isolated data:',dirs.join(', '));}
