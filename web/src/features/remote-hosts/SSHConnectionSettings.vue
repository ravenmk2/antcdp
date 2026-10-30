<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { ElButton, ElInput, ElMessage, ElMessageBox } from "element-plus";
import UiIcon from "../../shared/UiIcon.vue";
import { request } from "../../shared/api";
import { useUnsaved } from "./unsaved";
import { message, type RemoteHost, type Diagnostic } from "./types";
import DiagnosticResult from "./DiagnosticResult.vue";
const props=defineProps<{base:string;connection:RemoteHost;etag:string}>();
const emit=defineEmits<{saved:[RemoteHost,string]}>();
const editing=ref(false), busy=ref(false), error=ref(""), diagnostic=ref<Diagnostic|null>(null);
const form=reactive({name:"",description:"",host:"",port:"22"});
function reset(){ Object.assign(form,{name:props.connection.name,description:props.connection.description,host:props.connection.config?.host??"",port:String(props.connection.config?.port??22)}); }
watch(()=>props.connection,()=>{if(!editing.value)reset();void loadDiagnostic();},{immediate:true});
const dirty=computed(()=>editing.value&&(form.name!==props.connection.name||form.description!==props.connection.description||form.host!==props.connection.config?.host||Number(form.port)!==props.connection.config?.port));
async function loadDiagnostic(){try{diagnostic.value=(await request<{latest:Diagnostic|null}>(props.base+"/diagnostics")).data.latest;}catch(e){error.value=message(e);}}
async function reload(){if(dirty.value){try{await ElMessageBox.confirm("重新加载会丢弃未保存修改。","重新加载",{confirmButtonText:"重新加载",cancelButtonText:"取消"});}catch{return;}}try{const r=await request<RemoteHost>(props.base);editing.value=false;emit("saved",r.data,r.etag);error.value="";}catch(e){error.value=message(e);}}
async function save(){if(busy.value)return;busy.value=true;error.value="";try{
 const port=Number(form.port); if(!Number.isInteger(port)||port<1||port>65535)throw new Error("请输入 1–65535 的端口");
 if(form.host!==props.connection.config?.host||port!==props.connection.config?.port)await ElMessageBox.confirm("修改地址会清除原地址的受信任主机公钥，之后须重新核对。","修改主机地址",{confirmButtonText:"保存",cancelButtonText:"取消"});
 const r=await request<RemoteHost>(props.base,{method:"PATCH",etag:props.etag,body:{name:form.name,description:form.description,config:{host:form.host,port}}});editing.value=false;emit("saved",r.data,r.etag);ElMessage.success("主机已保存");
}catch(e){if(e!=="cancel"&&e!=="close")error.value=message(e);}finally{busy.value=false;}}
async function test(){busy.value=true;error.value="";try{diagnostic.value=(await request<Diagnostic>(props.base+"/test",{method:"POST",etag:props.etag,body:{}})).data;}catch(e){error.value=message(e);}finally{busy.value=false;}}
useUnsaved(()=>dirty.value,()=>busy.value);
</script>
<template>
 <section class="remote-host-section host-connection-settings">
 <div v-if="error" class="error-banner" role="alert">{{error}} <ElButton link @click="reload">重新加载</ElButton></div>
 <div class="host-connection-settings-heading"><h2>SSH 主机配置</h2><ElButton v-if="!editing" :disabled="busy" @click="reset();editing=true"><UiIcon name="edit"/>编辑</ElButton></div>
 <div v-if="!editing" class="host-connection-read-view"><dl class="host-connection-properties"><div><dt>主机名 / IP</dt><dd class="host-connection-technical-value">{{connection.config?.host}}</dd></div><div><dt>SSH 端口</dt><dd>{{connection.config?.port}}</dd></div><div><dt>连接方式</dt><dd>服务端直连</dd></div><div><dt>受信任公钥</dt><dd>{{connection.config?.host_keys?.length ? `${connection.config.host_keys.length} 把` : '未配置'}}</dd></div></dl>
 <div class="host-connection-test-section"><div><h3>连接测试</h3><p v-if="diagnostic"><DiagnosticResult :diagnostic="diagnostic"/> · {{new Date(diagnostic.started_at).toLocaleString()}}</p><p v-else>尚无测试记录</p><p>检查 SSH 握手和主机公钥，不发送登录凭证。</p></div><ElButton :disabled="busy||!connection.enabled" :loading="busy" @click="test">测试已保存主机</ElButton></div></div>
 <form v-else class="remote-host-form host-connection-form" @submit.prevent="save"><label>主机名称<ElInput v-model="form.name" maxlength="100" :disabled="busy"/></label><label>主机名 / IP<ElInput v-model="form.host" maxlength="253" :disabled="busy"/></label><label>SSH 端口<ElInput v-model="form.port" maxlength="5" :disabled="busy"/></label><label>说明<ElInput v-model="form.description" type="textarea" maxlength="1000" :disabled="busy"/></label><div class="remote-host-actions"><ElButton type="primary" native-type="submit" :loading="busy" :disabled="!dirty">保存主机</ElButton><ElButton :disabled="busy" @click="reset();editing=false;error=''">取消</ElButton></div></form>
 </section>
</template>
