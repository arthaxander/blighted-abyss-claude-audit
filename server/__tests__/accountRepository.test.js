const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const os=require('node:os'); const path=require('node:path'); const {SqliteAccountRepository}=require('../accountRepository'); const {validateGameName}=require('../nameValidation');
const make=()=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ashen-account-')); return {dir,file:path.join(dir,'db.sqlite'),repo:new SqliteAccountRepository(path.join(dir,'db.sqlite'))};};
test('Telegram ID alone defines identity across metadata changes and safely supports large IDs',()=>{const x=make(); const first=x.repo.getOrCreate({telegramUserId:'9007199254740993',telegramMetadata:{username:'one'}}); const same=x.repo.getOrCreate({telegramUserId:'9007199254740993',telegramMetadata:{username:'two',firstName:'Changed'}}); const other=x.repo.getOrCreate({telegramUserId:'9007199254740994',telegramMetadata:{}}); assert.equal(first.telegramUserId,same.telegramUserId); assert.notEqual(first.telegramUserId,other.telegramUserId); x.repo.close();});
test('save survives repository reload and stale revision cannot overwrite it',()=>{const x=make(); x.repo.getOrCreate({telegramUserId:'42'}); const saved=x.repo.save('42',{player:{silver:9}},0,1); assert.equal(saved.revision,1); assert.throws(()=>x.repo.save('42',{player:{silver:1}},0,1),/stale-revision/); x.repo.close(); const reopened=new SqliteAccountRepository(x.file); assert.equal(reopened.get('42').save.player.silver,9); reopened.close();});
test('first-login name is immutable once persisted and Unicode/control validation is enforced',()=>{const x=make(); x.repo.getOrCreate({telegramUserId:'7'}); assert.equal(x.repo.get('7').gameName,null); const valid=validateGameName('  Пепельный 🐉  '); assert.deepEqual(valid,{valid:true,value:'Пепельный 🐉'}); assert.equal(validateGameName(' \n ').valid,false); assert.equal(validateGameName('A').valid,false); x.repo.setName('7',valid.value); x.repo.setName('7','Другое имя'); assert.equal(x.repo.get('7').gameName,'Пепельный 🐉'); x.repo.close();});

test('malformed JSON never blocks account login and explicit reset archives the exact original bytes',()=>{
 const x=make(); const id='42'; x.repo.getOrCreate({telegramUserId:id}); x.repo.setName(id,'Путник');
 const bad='{invalid json after outage';
 x.repo.db.prepare('UPDATE game_accounts SET save_payload = ?, save_revision = ? WHERE telegram_user_id = ?').run(bad, 7, id);
 const account=x.repo.getOrCreate({telegramUserId:id});
 assert.equal(account.save,null); assert.equal(account.saveCorrupt,true); assert.equal(account.revision,7); assert.equal(account.gameName,'Путник');
 assert.throws(()=>x.repo.resetSave(id,6),/stale-revision/);
 const recovered=x.repo.resetSave(id,7);
 assert.equal(recovered.saveCorrupt,false); assert.equal(recovered.save,null); assert.equal(recovered.revision,8);
 assert.equal(recovered.gameName,'Путник');
 const archive=x.repo.db.prepare('SELECT * FROM save_recovery_archive WHERE telegram_user_id = ?').all(id);
 assert.equal(archive.length,1); assert.equal(archive[0].source_revision,7); assert.equal(archive[0].raw_payload,bad);
 assert.throws(()=>x.repo.resetSave(id,8),/save-empty/);
 x.repo.close();
});

test('corrupt JSON cannot be replaced through the ordinary save endpoint before archival',()=>{
 const x=make();x.repo.getOrCreate({telegramUserId:'99'});
 x.repo.db.prepare('UPDATE game_accounts SET save_payload = ? WHERE telegram_user_id = ?').run('{bad','99');
 assert.throws(()=>x.repo.save('99',{player:{hp:100}},0),/save-corrupt/);
 assert.equal(x.repo.get('99').saveCorrupt,true);
 x.repo.close();
});

test('valid JSON progress cannot be silently reset and malformed metadata is nonfatal',()=>{
 const x=make(); x.repo.getOrCreate({telegramUserId:'8'}); x.repo.save('8',{player:{hp:100}},0);
 x.repo.db.prepare('UPDATE game_accounts SET telegram_metadata = ? WHERE telegram_user_id = ?').run('invalid{','8');
 assert.equal(x.repo.get('8').save.player.hp,100);
 assert.deepEqual(x.repo.get('8').telegramMetadata,{});
 const cleared=x.repo.resetSave('8',1);
 assert.equal(cleared.revision,2);
 assert.equal(cleared.save,null);
 assert.deepEqual(JSON.parse(x.repo.db.prepare('SELECT raw_payload FROM save_recovery_archive WHERE telegram_user_id = ?').get('8').raw_payload),{player:{hp:100}});
 x.repo.close();
});
