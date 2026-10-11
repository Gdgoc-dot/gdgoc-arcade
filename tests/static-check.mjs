import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=path.resolve(new URL('..',import.meta.url).pathname);
const htmlFiles=['index.html','join.html','controller.html','leaderboard.html','admin.html'];
for(const file of htmlFiles){
  assert.ok(fs.existsSync(path.join(root,file)),`missing page ${file}`);
  const html=fs.readFileSync(path.join(root,file),'utf8');
  for(const match of html.matchAll(/(?:src|href)=["']([^"']+)["']/g)){
    const ref=match[1];
    if(/^(https?:|mailto:|tel:|#|data:|javascript:)/i.test(ref))continue;
    const pathname=decodeURIComponent(ref.split(/[?#]/)[0]);
    if(!pathname||pathname.endsWith('/'))continue;
    assert.ok(fs.existsSync(path.join(path.dirname(path.join(root,file)),pathname)),`${file} references missing local asset ${ref}`);
  }
}
const sourceFiles=[];
function walk(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const full=path.join(dir,entry.name);if(entry.isDirectory()){if(!['supabase','backend'].includes(entry.name))walk(full);}else if(entry.name.endsWith('.js'))sourceFiles.push(full);}}
walk(path.join(root,'src'));
for(const file of sourceFiles){
  const source=fs.readFileSync(file,'utf8');
  for(const match of source.matchAll(/(?:from\s*|import\s*\()['"](\.[^'"]+)['"]/g)){
    let ref=match[1];if(!path.extname(ref))ref+='.js';
    assert.ok(fs.existsSync(path.resolve(path.dirname(file),ref)),`${path.relative(root,file)} imports missing module ${ref}`);
  }
}
assert.ok(fs.existsSync(path.join(root,'backend/schema.sql')),'missing database schema');
assert.ok(fs.existsSync(path.join(root,'supabase/config.toml')),'missing Supabase CLI configuration');
const apiSource=fs.readFileSync(path.join(root,'src/services/api.js'),'utf8');
const controllerSource=fs.readFileSync(path.join(root,'src/controller/controller.js'),'utf8');
const displaySource=fs.readFileSync(path.join(root,'src/presentation/display.js'),'utf8');
const schemaSource=fs.readFileSync(path.join(root,'backend/schema.sql'),'utf8');
assert.match(apiSource,/arcade-controls-\$\{channelKey\}/,'controller traffic must use a per-participant channel topic');
assert.doesNotMatch(controllerSource,/token\s*:\s*participant\.token/,'raw controller tokens must never be broadcast');
assert.match(controllerSource,/channelKey:participantTokenHash/,'controller messages must identify their scoped channel key');
assert.match(displaySource,/payload\?\.channelKey!==activeTokenHash/,'host must reject messages from a different controller topic');
assert.match(schemaSource,/cp\.value in \('1480','2820'\) and cp\.value::integer <= max_x/,'server scoring must reject checkpoints beyond validated progress');
console.log(`Static project checks passed: ${htmlFiles.length} pages, ${sourceFiles.length} JavaScript modules, local references and controller-scoping checks valid.`);
