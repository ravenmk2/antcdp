<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue';
import { ElButton, ElInput, ElSelect, ElOption, ElDialog, ElDropdown, ElDropdownMenu, ElDropdownItem, ElCheckbox, ElPagination, ElMessage, ElMessageBox } from 'element-plus';
import { api, request } from '../../shared/api';
import { errorMessage } from '../identity/store';
import UiIcon from '../../shared/UiIcon.vue';
import './repository-picker.css';
import './repository-details.css';
interface Repo { id:string; repo_id:string; name:string; namespace_path:string; full_path:string; connection_id:string; connection_name:string; connection_enabled:boolean; default_branch:string|null; remote_archived:boolean|null; web_url:string|null; http_clone_url:string|null; ssh_clone_url:string|null; last_synced_at:string; etag:string; already_linked?:boolean }
interface Page {items:Repo[];total:number;mutation_version:string}
interface Connection {id:string;name:string;enabled:boolean}
interface Group {id:string;name:string;full_path:string;parent_id:string|null}
const props=defineProps<{projectId:string;canManage:boolean}>();
const base=computed(()=>`/projects/${props.projectId}/repositories`), directory=computed(()=>`/admin/projects/${props.projectId}/repository-connections`);
const rows=ref<Repo[]>([]), total=ref(0), page=ref(1), size=ref(20), query=ref(''), filter=ref(''), tag=ref(''), loading=ref(false), error=ref(''), busy=ref(false), selected=ref(new Map<string,Repo>()), connections=ref<Connection[]>([]), knownConnections=ref(new Map<string,string>());
const picker=ref(false), connection=ref(''), pickerError=ref(''), remoteLoading=ref(false), remoteQuery=ref(''), scope=ref('all'), recursive=ref(false), remoteRows=ref<Repo[]>([]), nextCursor=ref<string|null>(null), cursor=ref(''), history=ref<string[]>([]), picked=ref(new Map<string,Repo>()), showPicked=ref(false);
const groups=ref<Group[]>([]), groupQuery=ref(''), trail=ref<Group[]>([]), groupNext=ref<string|null>(null), groupLoading=ref(false), groupError=ref('');
const connectionLoading=ref(false), submitError=ref(''), groupsVisible=ref(false);
const selectableRows=computed(()=>remoteRows.value.filter(r=>!r.already_linked));
const selectedOnPage=computed(()=>selectableRows.value.filter(r=>picked.value.has(r.repo_id)).length);
const currentGroup=computed(()=>trail.value.at(-1));
const diagnosis=ref<{status:string;reason?:string;finished_at:string;outdated:boolean}|null>(), diagnosisError=ref(''), diagnosisLoading=ref(false);
type SyncResult={repo:Repo;status:'waiting'|'running'|'succeeded'|'failed';message:string};
const syncOpen=ref(false), syncResults=ref<SyncResult[]>([]);
const syncDone=computed(()=>syncResults.value.filter(r=>r.status==='succeeded'||r.status==='failed').length);
const syncSucceeded=computed(()=>syncResults.value.filter(r=>r.status==='succeeded').length);
const batchMode=ref(false), followSync=ref(true), syncList=ref<HTMLElement>();
let syncScrollTop=0;
function exitBatch(){if(busy.value)return;batchMode.value=false;selected.value.clear()}
async function followProgress(){
  await nextTick();
  const list=syncList.value;
  if(!list||!followSync.value||!busy.value)return;
  // Follow the earliest unfinished item, independent of response completion order.
  const index=syncResults.value.findIndex(item=>item.status==='running'||item.status==='waiting');
  const item=list.children.item(index) as HTMLElement|null;
  if(!item)return;
  const offset=item.getBoundingClientRect().top-list.getBoundingClientRect().top;
  const target=Math.min(list.scrollHeight-list.clientHeight,Math.max(list.scrollTop,list.scrollTop+offset-12));
  list.scrollTop=target;syncScrollTop=list.scrollTop;
}
function onSyncScroll(){
  const top=syncList.value?.scrollTop||0;
  if(top<syncScrollTop-1)followSync.value=false;
  syncScrollTop=top;
}
function resumeFollow(){followSync.value=true;void followProgress()}
watch(syncDone,()=>{void followProgress()});
const cloneProtocol=ref<'http'|'ssh'>('http'), copied=ref(false);
let copyTimer:ReturnType<typeof setTimeout>|undefined;
const cloneAddress=computed(()=>cloneProtocol.value==='http'?detail.value?.http_clone_url:detail.value?.ssh_clone_url);
const diagnosticLabel=computed(()=>diagnosisLoading.value?'加载中':diagnosisError.value?'记录加载失败':!diagnosis.value?'尚无同步记录':diagnosis.value.outdated?'历史同步记录':diagnosis.value.status==='succeeded'?'同步成功':'同步失败');
const diagnosticReasons:Record<string,string>={REMOTE_AUTHENTICATION_FAILED:'系统首选凭证认证失败',REMOTE_ACCESS_DENIED:'当前凭证无权访问',REMOTE_REPOSITORY_UNAVAILABLE:'仓库不存在或当前凭证无权访问',REMOTE_TIMEOUT:'GitLab 请求超时',REMOTE_UNAVAILABLE:'暂时无法访问 GitLab',REMOTE_INVALID_RESPONSE:'GitLab 返回的信息无效',RATE_LIMITED:'请求频率受限，请稍后重试'};
const detail=ref<Repo>(), detailOpen=ref(false), removeOpen=ref(false), removeRows=ref<Repo[]>([]);
let localEpoch=0,remoteEpoch=0,groupEpoch=0;let localTimer:ReturnType<typeof setTimeout>|undefined,remoteTimer:ReturnType<typeof setTimeout>|undefined,groupTimer:ReturnType<typeof setTimeout>|undefined;
async function load(){const epoch=++localEpoch;loading.value=true;error.value='';try{const q=new URLSearchParams({q:query.value,page:String(page.value),page_size:String(size.value)});if(filter.value)q.set('connection_id',filter.value);const v=await api<Page>(`${base.value}?${q}`);if(epoch!==localEpoch)return;rows.value=v.items;total.value=v.total;tag.value=v.mutation_version;v.items.forEach(r=>knownConnections.value.set(r.connection_id,r.connection_name));if(!v.items.length&&page.value>1){page.value--;return}}catch(e){if(epoch===localEpoch)error.value=errorMessage(e)}finally{if(epoch===localEpoch)loading.value=false}}
async function loadConnections(){
  connectionLoading.value=true;
  try {
    connections.value=(await api<{items:Connection[]}>(directory.value)).items;
    connections.value.forEach(c=>knownConnections.value.set(c.id,c.name));
    return true;
  } catch(e) { pickerError.value=errorMessage(e); return false; }
  finally { connectionLoading.value=false; }
}
watch(()=>props.projectId,()=>{batchMode.value=false;selected.value.clear();knownConnections.value.clear();picker.value=false;page.value=1;void load();if(props.canManage)void loadConnections()},{immediate:true});
watch(()=>props.canManage,()=>{selected.value.clear();if(!props.canManage){batchMode.value=false;picker.value=false;remoteEpoch++;groupEpoch++}else void loadConnections()});
watch([query,filter,size],()=>{selected.value.clear();page.value=1;clearTimeout(localTimer);localTimer=setTimeout(load,300)});watch(page,load);
function select(r:Repo,on:boolean){on?selected.value.set(r.id,r):selected.value.delete(r.id)}
function selectRemote(r:Repo,on:boolean){
  if(on && !picked.value.has(r.repo_id) && picked.value.size>=100){ElMessage.warning('每批最多关联 100 个仓库');return}
  on?picked.value.set(r.repo_id,r):picked.value.delete(r.repo_id);
}
function selectPage(on:boolean){
  if(!on){selectableRows.value.forEach(r=>picked.value.delete(r.repo_id));return}
  const remaining=selectableRows.value.filter(r=>!picked.value.has(r.repo_id));
  const available=100-picked.value.size;
  remaining.slice(0,available).forEach(r=>picked.value.set(r.repo_id,r));
  if(remaining.length>available)ElMessage.warning('已达到每批 100 个仓库的上限');
}
function remove(items:Repo[]){removeRows.value=items;removeOpen.value=true}
async function confirmRemove(){busy.value=true;try{await request(base.value+'/batch-unlink',{method:'POST',body:{ids:removeRows.value.map(r=>r.id)},etag:tag.value});removeOpen.value=false;selected.value.clear();ElMessage.success('已解除关联');await load()}catch(e){ElMessage.error(errorMessage(e));removeOpen.value=false;selected.value.clear();await load()}finally{busy.value=false}}
async function refresh(r:Repo){busy.value=true;try{await request(`${base.value}/${r.id}/refresh`,{method:'POST',body:{},etag:r.etag});ElMessage.success('仓库信息已同步');await load()}catch(e){ElMessage.error(errorMessage(e))}finally{busy.value=false}}
function command(cmd:string,r:Repo){if(cmd==='refresh')void refresh(r);else remove([r])}
async function showDetail(r:Repo){
  detail.value=r;detailOpen.value=true;cloneProtocol.value=r.http_clone_url?'http':'ssh';copied.value=false;clearTimeout(copyTimer);
  diagnosis.value=undefined;diagnosisError.value='';diagnosisLoading.value=true;
  try{const data=await api<{latest:typeof diagnosis.value}>(`${base.value}/${r.id}/diagnostics`);if(detail.value?.id===r.id)diagnosis.value=data.latest}
  catch(e){if(detail.value?.id===r.id)diagnosisError.value=errorMessage(e)}
  finally{if(detail.value?.id===r.id)diagnosisLoading.value=false}
}
async function copy(text:string){
  try{
    if(navigator.clipboard&&window.isSecureContext)await navigator.clipboard.writeText(text);
    else{const focused=document.activeElement instanceof HTMLElement?document.activeElement:null;const input=document.createElement('textarea');input.value=text;input.style.position='fixed';input.style.opacity='0';document.body.appendChild(input);try{input.select();if(!document.execCommand('copy'))throw new Error('复制失败')}finally{input.remove();focused?.focus()}}
    copied.value=true;clearTimeout(copyTimer);copyTimer=setTimeout(()=>copied.value=false,2000);
  }catch{ElMessage.error('复制失败，请手动选择地址复制')}
}
watch(cloneProtocol,()=>{copied.value=false;clearTimeout(copyTimer)});
function batchCommand(cmd:string){if(cmd==='sync')void syncSelected();else remove([...selected.value.values()])}
async function syncSelected(){
  if(busy.value||!selected.value.size)return;
  const endpoint=base.value;
  syncResults.value=[...selected.value.values()].map(repo=>({repo,status:'waiting',message:''}));
  syncOpen.value=true;busy.value=true;followSync.value=true;syncScrollTop=0;let index=0;
  await nextTick();if(syncList.value)syncList.value.scrollTop=0;
  async function worker(){
    while(index<syncResults.value.length){
      const item=syncResults.value[index++]!;item.status='running';
      try{
        // Re-read the selected association so a retry uses the current object version.
        const current=await api<Repo>(`${endpoint}/${item.repo.id}`);
        await request(`${endpoint}/${item.repo.id}/refresh`,{method:'POST',body:{},etag:current.etag});
        item.status='succeeded';selected.value.delete(item.repo.id);
      }catch(e){item.status='failed';item.message=errorMessage(e)}
    }
  }
  try{await Promise.all(Array.from({length:Math.min(3,syncResults.value.length)},()=>worker()));await load()}
  finally{busy.value=false}
}
function invalidatePicker(){
  remoteEpoch++;groupEpoch++;
  clearTimeout(remoteTimer);clearTimeout(groupTimer);
  remoteLoading.value=false;groupLoading.value=false;
}
async function open(){
  invalidatePicker();pickerError.value='';submitError.value='';connection.value='';
  picked.value.clear();trail.value=[];groups.value=[];remoteRows.value=[];
  groupQuery.value='';remoteQuery.value='';scope.value='all';recursive.value=false;
  showPicked.value=false;groupsVisible.value=false;cursor.value='';history.value=[];
  nextCursor.value=null;groupNext.value=null;picker.value=true;
  if(!await loadConnections() || !picker.value)return;
  connection.value=connections.value.find(c=>c.enabled)?.id||'';
  if(connection.value){void loadGroups();resetSearch()}
  else pickerError.value='暂无已启用的 GitLab 连接，请先在服务集成中配置。';
}
async function close(done:()=>void){
  if(busy.value)return;
  if(picked.value.size){try{await ElMessageBox.confirm('关闭后将清空尚未提交的仓库选择。','放弃已选仓库？',{confirmButtonText:'放弃选择',cancelButtonText:'继续选择'})}catch{return}}
  invalidatePicker();done();
}
async function changeConnection(value:string){
  if(value===connection.value)return;
  if(picked.value.size){try{await ElMessageBox.confirm('切换服务连接将清空当前已选仓库。','切换连接？',{confirmButtonText:'切换',cancelButtonText:'取消'})}catch{return}}
  invalidatePicker();connection.value=value;picked.value.clear();trail.value=[];groups.value=[];
  groupQuery.value='';scope.value='all';remoteQuery.value='';recursive.value=false;
  submitError.value='';showPicked.value=false;void loadGroups();resetSearch();
}
async function loadGroups(more=false){
  if(!picker.value||!connection.value)return;
  clearTimeout(groupTimer);const epoch=++groupEpoch;groupLoading.value=true;groupError.value='';
  if(!more){groups.value=[];groupNext.value=null}
  try{
    const q=new URLSearchParams();
    if(groupQuery.value)q.set('q',groupQuery.value);else if(currentGroup.value)q.set('parent_id',currentGroup.value.id);
    if(more&&groupNext.value)q.set('cursor',groupNext.value);
    const data=await api<{items:Group[];next_cursor:string|null}>(`${directory.value}/${connection.value}/containers?${q}`);
    if(epoch!==groupEpoch)return;
    groups.value=more?[...groups.value,...data.items]:data.items;groupNext.value=data.next_cursor;
  }catch(e){if(epoch===groupEpoch)groupError.value=errorMessage(e)}
  finally{if(epoch===groupEpoch)groupLoading.value=false}
}
function enter(g:Group){
  trail.value=groupQuery.value?[g]:[...trail.value,g];groupQuery.value='';scope.value='group';
  showPicked.value=false;groupsVisible.value=false;void loadGroups();resetSearch();
}
function navigate(index:number){
  trail.value=trail.value.slice(0,index+1);groupQuery.value='';scope.value=currentGroup.value?'group':'all';
  showPicked.value=false;void loadGroups();resetSearch();
}
function resetSearch(){
  remoteEpoch++;cursor.value='';history.value=[];nextCursor.value=null;remoteRows.value=[];
  remoteLoading.value=!!connection.value;pickerError.value='';
  clearTimeout(remoteTimer);remoteTimer=setTimeout(search,300);
}
async function search(){
  if(!picker.value||!connection.value)return;
  clearTimeout(remoteTimer);const epoch=++remoteEpoch;remoteLoading.value=true;pickerError.value='';remoteRows.value=[];
  try{
    const q=new URLSearchParams({q:remoteQuery.value});
    if(scope.value==='group'&&currentGroup.value){q.set('container_id',currentGroup.value.id);q.set('recursive',String(recursive.value))}
    if(cursor.value)q.set('cursor',cursor.value);
    const data=await api<{items:Repo[];next_cursor:string|null}>(`${directory.value}/${connection.value}/repos?${q}`);
    if(epoch!==remoteEpoch)return;
    remoteRows.value=data.items;nextCursor.value=data.next_cursor;
  }catch(e){if(epoch===remoteEpoch){pickerError.value=errorMessage(e);nextCursor.value=null}}
  finally{if(epoch===remoteEpoch)remoteLoading.value=false}
}
watch([remoteQuery,scope,recursive],()=>{if(picker.value)resetSearch()});
watch(groupQuery,()=>{
  if(!picker.value)return;groupEpoch++;groups.value=[];groupNext.value=null;groupLoading.value=!!connection.value;
  clearTimeout(groupTimer);groupTimer=setTimeout(()=>loadGroups(),300);
});
function next(){if(!nextCursor.value||remoteLoading.value)return;history.value.push(cursor.value);cursor.value=nextCursor.value;void search()}
function previous(){if(remoteLoading.value)return;cursor.value=history.value.pop()||'';void search()}
async function save(){
  if(!picked.value.size||busy.value)return;busy.value=true;submitError.value='';
  try{
    await request(base.value,{method:'POST',body:{connection_id:connection.value,repo_ids:[...picked.value.keys()]},etag:tag.value});
    invalidatePicker();picker.value=false;picked.value.clear();ElMessage.success('仓库已关联');await load();
  }catch(e){submitError.value=errorMessage(e);await load()}
  finally{busy.value=false}
}
onBeforeUnmount(()=>{clearTimeout(copyTimer);localEpoch++;remoteEpoch++;groupEpoch++;clearTimeout(localTimer);clearTimeout(remoteTimer);clearTimeout(groupTimer)});
</script>
<template>
<section class="project-repos" aria-label="项目 Git 仓库">
 <div class="repo-panel"><div class="repo-toolbar"><ElInput v-model="query" clearable placeholder="搜索仓库名称或完整路径" aria-label="搜索关联仓库"/><ElSelect v-model="filter" placeholder="全部连接" clearable aria-label="连接筛选"><ElOption v-for="[id,name] in knownConnections" :key="id" :value="id" :label="name"/></ElSelect><span class="repo-spacer"/>
 <template v-if="canManage">
  <ElButton v-if="!batchMode" :disabled="busy||loading||!total" @click="batchMode=true">批量操作</ElButton>
  <template v-else><span>已选 {{selected.size}} 项</span><ElButton :disabled="busy||!selected.size" @click="syncSelected">同步信息</ElButton><ElDropdown @command="batchCommand"><ElButton :disabled="busy||!selected.size">更多<UiIcon name="chevron"/></ElButton><template #dropdown><ElDropdownMenu><ElDropdownItem command="unlink" class="repo-danger"><UiIcon name="delete"/>解除所选关联</ElDropdownItem></ElDropdownMenu></template></ElDropdown><ElButton text :disabled="busy" @click="exitBatch">退出批量操作</ElButton></template>
 </template>
 <ElButton v-if="canManage" type="primary" :disabled="busy||loading" @click="open">关联仓库</ElButton></div>
 <div v-if="loading" class="repo-empty" role="status">正在加载仓库…</div><div v-else-if="error" class="repo-empty" role="alert">{{error}} <ElButton @click="load">重试</ElButton></div>
 <div v-else-if="!rows.length" class="repo-empty">{{query||filter?'没有匹配的仓库，请调整筛选。':'尚未关联 Git 仓库。'}}</div>
 <div v-else class="repo-scroll"><table class="repo-table"><colgroup><col v-if="canManage&&batchMode" class="repo-selection-col"/><col/><col class="repo-connection-col"/><col class="repo-branch-col"/><col class="repo-time-col"/><col class="repo-operation-col"/></colgroup><thead><tr><th v-if="canManage&&batchMode" class="repo-selection"><ElCheckbox :indeterminate="rows.some(r=>selected.has(r.id))&&!rows.every(r=>selected.has(r.id))" :model-value="rows.every(r=>selected.has(r.id))" :disabled="busy" aria-label="选择当前页" @change="v=>rows.forEach(r=>select(r,!!v))"/></th><th class="repo-name-heading">仓库</th><th>服务连接</th><th>默认分支</th><th>最近同步</th><th class="repo-actions-heading">操作</th></tr></thead><tbody><tr v-for="r in rows" :key="r.id"><td v-if="canManage&&batchMode" class="repo-selection"><ElCheckbox :model-value="selected.has(r.id)" :disabled="busy" :aria-label="`选择 ${r.name}`" @change="v=>select(r,!!v)"/></td><td class="repo-name-cell"><div class="repo-identity"><UiIcon name="repository"/><div class="repo-identity-text"><strong>{{r.name}}</strong><span v-if="r.remote_archived" class="repo-badge">远端已归档</span><div class="repo-path">{{r.full_path}}</div></div></div></td><td>{{r.connection_name}}<span v-if="!r.connection_enabled" class="repo-badge">停用</span></td><td>{{r.default_branch||'暂无'}}</td><td>{{new Date(r.last_synced_at).toLocaleString()}}</td><td class="repo-actions"><div class="repo-row-actions"><ElButton text @click="showDetail(r)">详情</ElButton><ElDropdown v-if="canManage" @command="cmd=>command(cmd,r)"><ElButton text :disabled="busy" :aria-label="`${r.name} 更多操作`"><UiIcon name="more"/></ElButton><template #dropdown><ElDropdownMenu><ElDropdownItem command="refresh" :disabled="!r.connection_enabled">同步仓库信息</ElDropdownItem><ElDropdownItem command="unlink" divided class="repo-danger">解除关联</ElDropdownItem></ElDropdownMenu></template></ElDropdown></div></td></tr></tbody></table></div>
 <div v-if="!loading&&!error" class="repo-footer"><span>共 {{total}} 个仓库</span><ElPagination v-model:current-page="page" v-model:page-size="size" :total="total" :page-sizes="[10,20,50,100]" layout="sizes, prev, pager, next"/></div></div>
 <ElDialog v-model="picker" title="关联 Git 仓库" width="1120px" top="6vh" class="repository-picker" :before-close="close" :close-on-click-modal="false">
  <div class="rp-source">
    <label for="repo-connection">服务连接</label>
    <ElSelect id="repo-connection" :model-value="connection" :loading="connectionLoading" :disabled="busy||connectionLoading" placeholder="选择 GitLab 连接" @change="changeConnection">
      <ElOption v-for="c in connections" :key="c.id" :value="c.id" :label="c.name" :disabled="!c.enabled"/>
    </ElSelect>
    <span class="rp-auth"><UiIcon name="key"/>系统首选凭证</span>
  </div>
  <div class="rp-workspace">
    <aside class="rp-navigation" :class="{ 'is-expanded': groupsVisible }" aria-label="GitLab 分组导航">
      <button class="rp-mobile-toggle" :aria-expanded="groupsVisible" aria-controls="repo-group-navigation" @click="groupsVisible=!groupsVisible"><UiIcon name="folder"/>{{currentGroup?.name||'浏览组'}}<UiIcon :name="groupsVisible?'close':'chevron'"/></button>
      <div id="repo-group-navigation" class="rp-navigation-body">
        <button class="rp-all" :class="{ active:!currentGroup&&!groupQuery }" :disabled="busy||!connection" @click="navigate(-1)"><UiIcon name="layers"/>全部仓库</button>
        <div class="rp-group-heading"><span>{{groupQuery?'搜索结果':currentGroup?'子组':'组'}}</span><button v-if="currentGroup" class="rp-back" :disabled="busy" @click="navigate(trail.length-2)"><UiIcon name="back"/>上一级</button></div>
        <ElInput v-model="groupQuery" :disabled="busy||!connection" clearable placeholder="搜索所有组" aria-label="搜索所有组"><template #prefix><UiIcon name="search"/></template></ElInput>
        <div class="rp-group-list" :aria-busy="groupLoading">
          <div v-if="groupError" class="rp-group-message" role="alert">{{groupError}}<ElButton text @click="loadGroups()">重试</ElButton></div>
          <button v-for="g in groups" :key="g.id" class="rp-group" :disabled="busy" :title="g.full_path" @click="enter(g)"><UiIcon name="folder"/><span><strong>{{g.name}}</strong><small v-if="groupQuery">{{g.full_path}}</small></span><UiIcon name="chevron"/></button>
          <p v-if="groupLoading" class="rp-group-message" role="status">正在加载组…</p>
          <p v-else-if="!groups.length&&!groupError" class="rp-group-message">{{groupQuery?'没有匹配的组':currentGroup?'此组没有可见子组':'暂无可见分组'}}</p>
          <ElButton v-if="groupNext" text :loading="groupLoading" :disabled="busy" @click="loadGroups(true)">加载更多组</ElButton>
        </div>
      </div>
    </aside>
    <section class="rp-main" aria-label="仓库选择">
      <div class="rp-result-heading">
        <nav v-if="!showPicked" class="rp-breadcrumb" aria-label="当前组路径"><button :disabled="busy" @click="navigate(-1)">全部仓库</button><template v-for="(g,index) in trail" :key="g.id"><UiIcon name="chevron"/><button :disabled="busy" :aria-current="index===trail.length-1?'location':undefined" :title="g.full_path" @click="navigate(index)">{{g.name}}</button></template></nav>
        <h3 v-else>已选仓库 <span>{{picked.size}}</span></h3>
        <button class="rp-view-toggle" :aria-pressed="showPicked" @click="showPicked=!showPicked">{{showPicked?'返回仓库列表':`查看已选 (${picked.size})`}}</button>
      </div>
      <template v-if="!showPicked">
        <div class="rp-search"><ElInput v-model="remoteQuery" :disabled="busy||!connection" clearable placeholder="搜索仓库名称或路径" aria-label="搜索远端仓库"><template #prefix><UiIcon name="search"/></template></ElInput>
          <ElSelect v-if="currentGroup" v-model="scope" :disabled="busy" aria-label="搜索范围"><ElOption value="all" label="整个连接"/><ElOption value="group" label="当前组"/></ElSelect>
        </div>
        <div class="rp-options"><ElCheckbox :disabled="busy||remoteLoading||!selectableRows.length" :indeterminate="selectedOnPage>0&&selectedOnPage<selectableRows.length" :model-value="selectableRows.length>0&&selectedOnPage===selectableRows.length" @change="v=>selectPage(!!v)">选择本页</ElCheckbox><span class="rp-result-count">{{remoteLoading?'查询中…':remoteRows.length?`本页 ${remoteRows.length} 个仓库`:''}}</span><ElCheckbox v-if="currentGroup&&scope==='group'" v-model="recursive" :disabled="busy">包含子组</ElCheckbox><span v-else class="rp-range">整个连接</span></div>
        <div class="rp-repository-list" :aria-busy="remoteLoading||connectionLoading">
          <div v-if="remoteLoading||connectionLoading" class="rp-empty" role="status"><UiIcon name="refresh" class="rp-spin"/><strong>正在加载仓库</strong></div>
          <div v-else-if="pickerError" class="rp-empty" role="alert"><UiIcon name="service"/><strong>暂时无法获取仓库</strong><p>{{pickerError}}</p><ElButton :disabled="busy" @click="connection?resetSearch():open()">重新加载</ElButton></div>
          <div v-else-if="!remoteRows.length" class="rp-empty"><UiIcon name="search"/><strong>没有找到仓库</strong><p>{{remoteQuery?'试试其他关键词，或调整搜索范围。':'可切换分组，或搜索整个连接的仓库。'}}</p><ElButton v-if="currentGroup" text @click="scope='all'">搜索整个连接</ElButton></div>
          <div v-for="r in remoteLoading||pickerError?[]:remoteRows" :key="r.repo_id" class="rp-repository" :class="{ selected:picked.has(r.repo_id), linked:r.already_linked }">
            <ElCheckbox :id="`repo-choice-${r.repo_id}`" :model-value="picked.has(r.repo_id)" :disabled="busy||r.already_linked" :aria-label="`选择 ${r.name}`" @change="v=>selectRemote(r,!!v)"/>
            <UiIcon name="code" class="rp-repo-icon"/><label class="rp-repo-name" :for="`repo-choice-${r.repo_id}`"><strong>{{r.name}}</strong><small>{{r.full_path}}</small></label>
            <span class="rp-repo-meta"><span v-if="r.already_linked" class="rp-linked"><UiIcon name="check"/>已关联</span><span v-else-if="r.remote_archived" class="rp-archived">已归档</span><span v-else>{{r.default_branch||'空仓库'}}</span></span>
          </div>
        </div>
        <div class="rp-pagination"><span>第 {{history.length+1}} 页</span><div><ElButton :disabled="busy||remoteLoading||!history.length" aria-label="仓库上一页" @click="previous"><UiIcon name="chevron-left"/></ElButton><ElButton :disabled="busy||remoteLoading||!nextCursor" aria-label="仓库下一页" @click="next"><UiIcon name="chevron"/></ElButton></div></div>
      </template>
      <div v-else class="rp-selected-list">
        <div v-if="!picked.size" class="rp-empty"><UiIcon name="code"/><strong>尚未选择仓库</strong><p>返回列表，勾选需要关联的仓库。</p><ElButton @click="showPicked=false">浏览仓库</ElButton></div>
        <div v-for="[id,r] in picked" :key="id" class="rp-repository"><UiIcon name="code" class="rp-repo-icon"/><span class="rp-repo-name"><strong>{{r.name}}</strong><small>{{r.full_path}}</small></span><ElButton text :disabled="busy" :aria-label="`移除 ${r.name}`" @click="picked.delete(id)"><UiIcon name="close"/></ElButton></div>
      </div>
    </section>
  </div>
  <template #footer>
    <div v-if="submitError" class="rp-submit-error" role="alert">{{submitError}}。已保留选择，可调整后重试。</div>
    <div class="rp-bottom"><div class="rp-selection-summary"><strong>已选 {{picked.size}} 个仓库</strong><span>{{picked.size>=100?'已达到单次关联上限':'可跨组、跨页选择'}}</span></div><div class="rp-bottom-actions"><ElButton :disabled="busy" @click="close(()=>picker=false)">取消</ElButton><ElButton type="primary" :loading="busy" :disabled="!picked.size||connectionLoading" @click="save">{{picked.size?`关联 ${picked.size} 个仓库`:'关联仓库'}}</ElButton></div></div>
  </template>
 </ElDialog>
 <ElDialog v-model="detailOpen" title="仓库详情" width="680px" class="repository-detail" align-center>
  <template v-if="detail">
    <div class="rd-heading"><div class="rd-icon"><UiIcon name="code"/></div><div class="rd-title"><h3>{{detail.name}}</h3><p>{{detail.full_path}}</p></div><a v-if="detail.web_url" class="rd-visit" :href="detail.web_url" target="_blank" rel="noopener noreferrer">打开仓库<UiIcon name="arrow"/></a></div>
    <dl class="rd-metadata"><div><dt>服务连接</dt><dd>{{detail.connection_name}}<span v-if="!detail.connection_enabled" class="rd-label">已停用</span></dd></div><div><dt>默认分支</dt><dd><UiIcon name="code"/>{{detail.default_branch||'暂无默认分支'}}</dd></div><div><dt>远端仓库 ID</dt><dd class="rd-mono">{{detail.repo_id}}</dd></div><div><dt>仓库状态</dt><dd>{{detail.remote_archived===null?'未知':detail.remote_archived?'已归档':'正常'}}</dd></div></dl>
    <section class="rd-clone" aria-label="克隆地址"><div class="rd-section-heading"><h4>克隆地址</h4><div class="rd-protocols" role="group" aria-label="克隆协议"><button :aria-pressed="cloneProtocol==='http'" :class="{active:cloneProtocol==='http'}" @click="cloneProtocol='http'">HTTPS</button><button :aria-pressed="cloneProtocol==='ssh'" :class="{active:cloneProtocol==='ssh'}" @click="cloneProtocol='ssh'">SSH</button></div></div><div class="rd-address"><code>{{cloneAddress||'该仓库未提供此协议的地址'}}</code><ElButton v-if="cloneAddress" text :aria-label="copied?'已复制':'复制克隆地址'" @click="copy(cloneAddress)"><UiIcon :name="copied?'check':'copy'" :class="{ 'rd-copied':copied }"/></ElButton></div></section>
    <section class="rd-sync" aria-label="仓库同步信息"><div class="rd-section-heading"><h4>同步信息</h4><span class="rd-sync-status" :class="{success:diagnosis?.status==='succeeded'&&!diagnosis.outdated,failure:diagnosis?.status==='failed'&&!diagnosis.outdated}">{{diagnosticLabel}}</span></div><div class="rd-sync-time"><span>最近成功获取</span><time>{{new Date(detail.last_synced_at).toLocaleString()}}</time></div><p v-if="diagnosis?.status==='failed'" class="rd-sync-note">{{diagnosticReasons[diagnosis.reason||'']||'暂时无法同步仓库信息'}}；保留上次成功获取的信息。</p><p v-if="diagnosis?.outdated" class="rd-sync-note">连接或凭证已变化，该记录不代表当前访问状态。</p><div v-if="diagnosisError" class="rd-sync-note">{{diagnosisError}}<ElButton text @click="showDetail(detail!)">重试</ElButton></div></section>
    <p class="rd-permission"><UiIcon name="lock"/>访问和克隆仓库仍需具备 Git 平台权限。</p>
  </template>
 </ElDialog>
 <ElDialog v-model="syncOpen" :title="busy?'正在同步仓库信息':'同步结果'" width="640px" class="repository-sync-results" top="6vh" @opened="followProgress" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy">
   <div class="rs-summary" aria-live="polite"><strong>{{syncDone}} / {{syncResults.length}}</strong><span>{{busy?'已处理':`同步成功 ${syncSucceeded} 个，失败 ${syncResults.length-syncSucceeded} 个`}}</span></div>
   <progress class="rs-progress" :value="syncDone" :max="syncResults.length||1" aria-label="同步进度"/>
   <div class="rs-follow"><span>{{busy?(followSync?'正在跟随同步进度':'已暂停自动跟随'):'同步已结束'}}</span><ElButton v-if="busy&&!followSync" text @click="resumeFollow">继续跟随</ElButton></div>
   <div ref="syncList" class="rs-list" tabindex="0" aria-label="仓库同步结果列表" @scroll="onSyncScroll" @wheel="event=>{if(event.deltaY<0)followSync=false}" @keydown="event=>{if(['ArrowUp','PageUp','Home'].includes(event.key))followSync=false}"><div v-for="item in syncResults" :key="item.repo.id" class="rs-item"><div><strong>{{item.repo.name}}</strong><small>{{item.repo.full_path}}</small><p v-if="item.message">{{item.message}}</p></div><span :class="item.status">{{({waiting:'等待中',running:'同步中',succeeded:'已同步',failed:'失败'})[item.status]}}</span></div></div>
   <template #footer><span v-if="!busy&&syncSucceeded<syncResults.length" class="rs-retry-note">失败项仍保持选中，可关闭后重试。</span><ElButton :disabled="busy" @click="syncOpen=false">完成</ElButton></template>
 </ElDialog>
 <ElDialog v-model="removeOpen" :title="`解除 ${removeRows.length} 个仓库的关联？`" width="560px" :close-on-click-modal="false" :show-close="!busy" :close-on-press-escape="!busy"><p>仅移除它们与当前项目的关联，不会删除远端仓库。</p><ul class="repo-remove-list"><li v-for="r in removeRows" :key="r.id">{{r.full_path}}</li></ul><template #footer><ElButton :disabled="busy" @click="removeOpen=false">取消</ElButton><ElButton type="danger" :loading="busy" @click="confirmRemove">解除关联</ElButton></template></ElDialog>
</section>
</template>
<style scoped>
.repo-panel{border:1px solid var(--el-border-color);border-radius:8px;overflow:hidden;background:var(--el-bg-color)}.repo-toolbar,.repo-footer,.repo-dialog-footer{display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:16px}.repo-toolbar .el-input{width:280px}.repo-toolbar .el-select{width:190px}.repo-spacer{flex:1}.repo-scroll{overflow:auto}.repo-table{width:100%;border-collapse:collapse;table-layout:fixed;min-width:800px;text-align:left;font-size:14px}.repo-table th{text-align:center;font-size:12px;font-weight:500;color:var(--el-text-color-secondary);background:var(--el-fill-color-light)}.repo-table th,.repo-table td{padding:12px 16px;border-top:1px solid var(--el-border-color-lighter)}.repo-table td{vertical-align:middle;overflow-wrap:anywhere;text-align:center}
.repo-table .repo-name-heading,.repo-table .repo-name-cell{text-align:left}
.repo-selection-col{width:48px}.repo-connection-col{width:18%}.repo-branch-col{width:13%}.repo-time-col{width:180px}.repo-operation-col{width:132px}
.repo-table .repo-selection{width:48px;padding:12px 0;text-align:center;vertical-align:middle}.repo-selection :deep(.el-checkbox){margin:0;vertical-align:middle}.repo-selection :deep(.el-checkbox__label){display:none}
.repo-identity{display:flex;align-items:center;gap:12px}.repo-identity>.ui-icon{width:24px;height:24px;color:var(--el-text-color-secondary);flex:none}.repo-identity-text{min-width:0}
.repo-path{font-size:12px;color:var(--el-text-color-secondary);overflow-wrap:anywhere;margin-top:4px}.repo-badge{font-size:12px;margin-left:8px;padding:2px 5px;background:var(--el-fill-color);border-radius:4px}.repo-actions{width:132px;white-space:nowrap}.repo-actions-heading{text-align:center;width:132px}.repo-row-actions{display:flex;align-items:center;justify-content:center;gap:4px}.repo-row-actions .el-button{margin:0}.repo-row-actions .el-dropdown{display:inline-flex}.repo-danger{color:var(--el-color-danger)!important}.repo-footer{justify-content:space-between;border-top:1px solid var(--el-border-color-lighter);font-size:12px;color:var(--el-text-color-secondary)}.repo-empty{padding:48px 16px;text-align:center;color:var(--el-text-color-secondary)}.repo-remove-list{max-height:260px;overflow:auto;overflow-wrap:anywhere}.repo-details dt{color:var(--el-text-color-secondary);font-size:12px;margin-top:16px}.repo-details dd{margin:6px 0;overflow-wrap:anywhere}.repo-details a{color:var(--el-color-primary)}@media(max-width:760px){.repo-toolbar .el-input{width:100%}}
</style>
<style>.el-dropdown-menu__item.repo-danger{color:var(--el-color-danger)!important}</style>
