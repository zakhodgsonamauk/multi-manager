const fs=require('fs'),vm=require('vm'),cp=require('child_process');
let KEY=process.env.LEADERGPU_LLM_KEY||'';
if(!KEY){try{const o=cp.execSync('reg query HKCU\\Environment /v LEADERGPU_LLM_KEY',{encoding:'utf8'});const m=o.match(/REG_\w+\s+(.+)/);if(m)KEY=m[1].trim();}catch{}}
const BOX='http://100.125.235.75:8800',GLM='http://localhost:11434',STR='http://127.0.0.1:47831';
const PROMPT="Write a JavaScript function `parseDuration(s)` that converts strings like '1h30m', '45s', '2h', '1h 5m 10s', '90m' into a total number of seconds. Accept optional spaces between parts, units h/m/s in that order, each at most once. Return null for invalid input such as '', 'abc', '5x', '1m1h', '1h1h', '-5s'. Reply with only the function in one ```js code block.";
const TESTS=[['1h30m',5400],['45s',45],['2h',7200],['1h 5m 10s',3910],['90m',5400],['',null],['abc',null],['5x',null],['1m1h',null],['1h1h',null],['-5s',null],['0s',0],[' 1h ',3600],['1H',null],['1h 30',null],['1.5h',null]];
const TOOL_PROMPT="What is in the file notes.txt? Use the tool.";
const san=s=>KEY?String(s).split(KEY).join('***'):String(s);
async function j(url,opt){const r=await fetch(url,{...opt,signal:AbortSignal.timeout(opt.timeout||300000)});if(!r.ok)throw new Error('HTTP '+r.status+' '+(await r.text()).slice(0,200));return r;}
async function sse(res,onEv){const rd=res.body.getReader(),dec=new TextDecoder();let buf='';for(;;){const{done,value}=await rd.read();if(done)break;buf+=dec.decode(value,{stream:true});let i;while((i=buf.indexOf('\n'))>=0){const l=buf.slice(0,i).trim();buf=buf.slice(i+1);if(l.startsWith('data:')){const d=l.slice(5).trim();if(d&&d!=='[DONE]'){try{onEv(JSON.parse(d));}catch{}}}}}}
const B={
glm:{name:'glm',model:'glm-5.3:cloud',fmt:'anth',url:GLM+'/v1/messages',hdr:{'x-api-key':'ollama','anthropic-version':'2023-06-01'}},
box:{name:'box',fmt:'anth',url:BOX+'/v1/messages',hdr:{Authorization:'Bearer '+KEY,'anthropic-version':'2023-06-01'}},
strata:{name:'strata',fmt:'oai',url:STR+'/v1/chat/completions',hdr:{}}};
async function discover(b){
 if(b.name==='box'){const h={Authorization:'Bearer '+KEY};const m=await(await j(BOX+'/v1/models',{headers:h,timeout:15000})).json();b.model=m.data[0].id;try{b.status=await(await j(BOX+'/status',{headers:h,timeout:15000})).json();}catch(e){b.status='err '+e.message}}
 if(b.name==='strata'){const m=await(await j(STR+'/v1/models',{timeout:10000})).json();const l=m.data.find(x=>x.status&&x.status.value==='loaded');if(!l)throw new Error('no loaded model');b.model=l.id;}
 if(b.name==='glm'){await j(GLM+'/api/tags',{timeout:10000});}
}
async function run(b){
 const t0=performance.now();let ttft=null,ttftAny=null,text='',think='',usage=null;
 const body=b.fmt==='anth'?{model:b.model,max_tokens:2000,temperature:0,stream:true,messages:[{role:'user',content:PROMPT}]}:{model:b.model,max_tokens:2000,temperature:0,stream:true,stream_options:{include_usage:true},messages:[{role:'user',content:PROMPT}]};
 const res=await j(b.url,{method:'POST',headers:{'content-type':'application/json',...b.hdr},body:JSON.stringify(body)});
 await sse(res,e=>{const now=performance.now()-t0;
  if(b.fmt==='anth'){
   if(e.type==='message_start'&&e.message.usage)usage={...usage,in:e.message.usage.input_tokens};
   if(e.type==='message_delta'&&e.usage)usage={...usage,out:e.usage.output_tokens};
   if(e.type==='content_block_delta'){ if(ttftAny==null)ttftAny=now; if(e.delta.type==='text_delta'){if(ttft==null)ttft=now;text+=e.delta.text;} else if(e.delta.thinking)think+=e.delta.thinking;}
  }else{
   if(e.usage)usage={in:e.usage.prompt_tokens,out:e.usage.completion_tokens};
   const d=e.choices&&e.choices[0]&&e.choices[0].delta;if(d){const r=d.reasoning_content||d.reasoning;if(r){if(ttftAny==null)ttftAny=now;think+=r;}if(d.content){if(ttftAny==null)ttftAny=now;if(ttft==null)ttft=now;text+=d.content;}}
  }});
 const total=performance.now()-t0;
 return{ttft_ms:ttft&&Math.round(ttft),ttft_any_ms:ttftAny&&Math.round(ttftAny),total_ms:Math.round(total),usage,tps:usage&&usage.out?+(usage.out/(total/1000)).toFixed(1):null,thinking_chars:think.length,text};
}
function extract(t){let m=t.match(/```(?:js|javascript)\s*\n([\s\S]*?)```/i)||t.match(/```\w*\s*\n([\s\S]*?)```/);return{code:m?m[1]:null,onlyBlock:m?t.replace(m[0],'').trim().length===0:false};}
function grade(code){if(!code)return{pass:0,fails:['no code']};const ctx=vm.createContext({});const fails=[];let pass=0;
 try{vm.runInContext(code+'\n;globalThis.__f=parseDuration;',ctx,{timeout:2000});}catch(e){return{pass:0,fails:['load: '+e.message]};}
 for(const[i,exp]of TESTS){try{ctx.__i=i;const r=vm.runInContext('__f(__i)',ctx,{timeout:2000});if(r===exp)pass++;else fails.push(JSON.stringify(i)+' got '+JSON.stringify(r)+' want '+exp);}catch(e){fails.push(JSON.stringify(i)+' threw '+e.message);}}
 return{pass,fails};}
async function tool(b){
 const t0=performance.now();let body,r;
 try{
 if(b.fmt==='anth'){body={model:b.model,max_tokens:1000,temperature:0,tools:[{name:'read_file',description:'Read a file',input_schema:{type:'object',properties:{path:{type:'string'}},required:['path']}}],messages:[{role:'user',content:TOOL_PROMPT}]};
  r=await(await j(b.url,{method:'POST',headers:{'content-type':'application/json',...b.hdr},body:JSON.stringify(body)})).json();
  const tu=(r.content||[]).find(c=>c.type==='tool_use');return{ok:!!(tu&&tu.name==='read_file'&&tu.input&&tu.input.path==='notes.txt'),call:tu||null,stop:r.stop_reason,ms:Math.round(performance.now()-t0),other:(r.content||[]).filter(c=>c.type!=='tool_use').map(c=>(c.text||c.thinking||'').slice(0,200))};}
 body={model:b.model,max_tokens:1000,temperature:0,tools:[{type:'function',function:{name:'read_file',description:'Read a file',parameters:{type:'object',properties:{path:{type:'string'}},required:['path']}}}],messages:[{role:'user',content:TOOL_PROMPT}]};
 r=await(await j(b.url,{method:'POST',headers:{'content-type':'application/json',...b.hdr},body:JSON.stringify(body)})).json();
 const m=r.choices[0].message,tc=(m.tool_calls||[])[0];let args=null;try{args=JSON.parse(tc.function.arguments)}catch{}
 return{ok:!!(tc&&tc.function.name==='read_file'&&args&&args.path==='notes.txt'),call:tc||null,stop:r.choices[0].finish_reason,ms:Math.round(performance.now()-t0),other:[(m.content||'').slice(0,200)]};
 }catch(e){return{ok:false,error:san(e.message)};}
}
(async()=>{const out={};
 for(const n of ['glm','box','strata']){const b=B[n];const o=out[n]={runs:[]};
  try{await discover(b);o.model=b.model;o.reachable=true;if(b.status)o.status=b.status;}catch(e){o.reachable=false;o.error=san(e.message);console.log(n,'not reachable',o.error);continue;}
  for(let i=0;i<3;i++){try{const r=await run(b);const x=extract(r.text);const g=grade(x.code);o.runs.push({...r,onlyBlock:x.onlyBlock,pass:g.pass,fails:g.fails});if(i===0&&x.code)fs.writeFileSync(n+'.js',x.code);console.log(n,'run',i,r.total_ms,'ms pass',g.pass,'/',TESTS.length);if(r.total_ms>60000)break;}catch(e){o.runs.push({error:san(e.message)});console.log(n,'run err',san(e.message));break;}}
  o.tool=await tool(b);console.log(n,'tool',o.tool.ok);
 }
 fs.writeFileSync('results.json',JSON.stringify(out,null,2));
 const all=['results.json','glm.js','box.js','strata.js'].filter(f=>fs.existsSync(f)).map(f=>fs.readFileSync(f,'utf8')).join('');
 console.log(KEY&&all.includes(KEY)?'KEY FOUND IN OUTPUTS':'key not found in outputs');
})();
