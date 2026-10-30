import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
function picker(apiHandler=async()=>({items:[],next_cursor:null}),write=async()=>({data:{}})) {
 const source=readFileSync(new URL('../src/features/collaboration/ProjectRepositories.vue',import.meta.url),'utf8').split('<script setup lang="ts">')[1].split('</script>')[0];
 const warnings=[],timers=new Map();let timerId=0;
 const ctx={exports:{},URLSearchParams,console,defineProps:()=>({projectId:'1',canManage:true}),setTimeout:fn=>{timers.set(++timerId,fn);return timerId},clearTimeout:id=>timers.delete(id),require(name){
 if(name==='vue')return {ref:value=>({value}),computed:fn=>({get value(){return fn()}}),watch(){},nextTick:async()=>{},onBeforeUnmount(){}};
 if(name==='element-plus')return {ElMessage:{success(){},error(){},warning:s=>warnings.push(s)},ElMessageBox:{confirm:async()=>{}}};
 if(name==='../../shared/api')return {api:apiHandler,request:write};
 if(name==='../identity/store')return {errorMessage:e=>e.message};return {};
 }};
 const expose='batchMode,busy,exitBatch,followSync,syncList,followProgress,onSyncScroll,resumeFollow,picker,connection,remoteRows,picked,remoteLoading,nextCursor,cursor,history,submitError,tag,selected,syncSelected,syncResults,syncOpen,syncDone,syncSucceeded,search,resetSearch,selectPage,selectRemote,save,close,changeConnection,groups,groupNext,loadGroups';
 vm.runInNewContext(ts.transpileModule(source+`\nexports.c={${expose}}`,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,ctx);
 const c=ctx.exports.c;c.picker.value=true;c.connection.value='gitlab';return {c,warnings,timers};
}
test('picker ignores a previous search response after scope changes',async()=>{
 const pending=[];const {c}=picker(()=>new Promise(resolve=>pending.push(resolve)));
 const first=c.search();c.resetSearch();assert.equal(c.remoteLoading.value,true);assert.equal(c.remoteRows.value.length,0);
 const second=c.search();pending[1]({items:[{repo_id:'new'}],next_cursor:null});await second;pending[0]({items:[{repo_id:'old'}],next_cursor:'old'});await first;
 assert.equal(c.remoteRows.value[0].repo_id,'new');assert.equal(c.nextCursor.value,null);
});
test('page selection respects the cap without repeated alerts or losing previous selections',()=>{
 const {c,warnings}=picker();for(let i=0;i<99;i++)c.picked.value.set(String(i),{repo_id:String(i)});
 c.remoteRows.value=[{repo_id:'99'},{repo_id:'100'},{repo_id:'101',already_linked:true}];c.selectPage(true);
 assert.equal(c.picked.value.size,100);assert.equal(c.picked.value.has('99'),true);assert.equal(c.picked.value.has('101'),false);assert.equal(warnings.length,1);
 c.selectPage(false);assert.equal(c.picked.value.size,99);
});
test('closing cancels delayed searches and invalidates requests without clearing the saved selection',async()=>{
 let resolve;const {c,timers}=picker(()=>new Promise(r=>resolve=r));c.picked.value.set('1',{repo_id:'1'});const request=c.search();c.resetSearch();await c.close(()=>c.picker.value=false);
 assert.equal(timers.size,0);resolve({items:[{repo_id:'late'}],next_cursor:'late'});await request;assert.equal(c.remoteRows.value.length,0);assert.equal(c.picker.value,false);
});
test('save failure retains selection and a separate actionable submission error',async()=>{
 const {c}=picker(async()=>({items:[],total:0,mutation_version:'fresh'}),async()=>{throw new Error('版本已变化')});c.picked.value.set('1',{repo_id:'1'});c.tag.value='old';await c.save();
 assert.equal(c.submitError.value,'版本已变化');assert.equal(c.picked.value.size,1);assert.equal(c.picker.value,true);assert.equal(c.tag.value,'fresh');
});

test('batch sync bounds concurrency and keeps only failed selections for retry',async()=>{
 let active=0,peak=0;const releases=[];
 const {c}=picker(async path=>path.match(/repositories\/\d+$/)?{etag:'latest'}:{items:[],total:0,mutation_version:'new'},async path=>{
  active++;peak=Math.max(peak,active);await new Promise(resolve=>releases.push(resolve));active--;
  if(path.endsWith('/2/refresh'))throw new Error('仓库权限不足');return {data:{}};
 });
 for(let i=1;i<=5;i++)c.selected.value.set(String(i),{id:String(i),name:'repo-'+i});
 const operation=c.syncSelected();await new Promise(setImmediate);assert.equal(peak,3);
 while(c.syncDone.value<5){releases.splice(0).forEach(resolve=>resolve());await new Promise(setImmediate)}
 await operation;assert.equal(peak,3);assert.equal(c.syncSucceeded.value,4);assert.equal(c.selected.value.size,1);assert.equal(c.selected.value.has('2'),true);assert.equal(c.syncResults.value[1].message,'仓库权限不足');
});

test('batch mode exits cleanly but cannot exit during sync',()=>{
 const {c}=picker();c.batchMode.value=true;c.selected.value.set('1',{});c.busy.value=true;c.exitBatch();assert.equal(c.batchMode.value,true);assert.equal(c.selected.value.size,1);
 c.busy.value=false;c.exitBatch();assert.equal(c.batchMode.value,false);assert.equal(c.selected.value.size,0);
});
test('sync follows ordered progress, pauses on upward scroll and stops after completion',async()=>{
 const {c}=picker();let top=0;
 const list={get scrollTop(){return top},set scrollTop(v){top=v},scrollHeight:1000,clientHeight:200,getBoundingClientRect:()=>({top:0}),children:{item:i=>i<0?null:{getBoundingClientRect:()=>({top:i*100-top})}}};
 c.syncList.value=list;c.busy.value=true;c.syncResults.value=[{status:'succeeded'},{status:'running'},{status:'succeeded'},{status:'running'}];
 await c.followProgress();assert.equal(top,88);top=20;c.onSyncScroll();assert.equal(c.followSync.value,false);
 c.syncResults.value[1].status='succeeded';await c.followProgress();assert.equal(top,20);
 c.resumeFollow();await new Promise(setImmediate);assert.equal(top,288);
 c.busy.value=false;c.syncResults.value[3].status='succeeded';await c.followProgress();assert.equal(top,288);
});
