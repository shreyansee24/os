const $ = (id) => document.getElementById(id);
let current = {files:[], folders:[], categories:{}, summary:null, recommendations:[]};
let categoryChart = null, folderChart = null, categoryBarChart = null;
const palette = ['#9b7cff','#648dff','#43d5dc','#ffb46b','#e878a9','#6bd6a5','#8d9bb8','#c1a4ff'];
const fmt = n => { if(n < 1024) return `${n} B`; const u=['KB','MB','GB','TB']; let i=-1; do{n/=1024;i++}while(n>=1024&&i<u.length-1); return `${n.toFixed(1)} ${u[i]}`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function alertMsg(message, type='error'){ $('alert').textContent=message; $('alert').className=`alert ${type}`; window.scrollTo({top:0,behavior:'smooth'}); }
function clearAlert(){ $('alert').className='alert hidden'; }
function showPage(name){
 document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id===`page-${name}`));
 document.querySelectorAll('.nav-link').forEach(a=>a.classList.toggle('active',a.dataset.page===name));
 const labels={dashboard:'Dashboard',analysis:'Storage Analysis',folders:'Folders',large:'Large Files',categories:'File Categories',recommendations:'Recommendations',history:'Scan History',settings:'Settings'};
 $('page-title').textContent=labels[name]||'Dashboard'; location.hash=name;
 if(name==='history') loadHistory(); if(name==='large') renderFiles(); if(name==='folders') renderFolders();
}
document.querySelectorAll('[data-page]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();showPage(a.dataset.page)}));
$('top-scan').onclick=()=>showPage('analysis');
$('browse-btn').onclick=async()=>{clearAlert();try{const r=await fetch('/api/select-folder',{method:'POST'});const d=await r.json();if(d.path)$('folder-path').value=d.path;else if(d.error)alertMsg(d.error);}catch(e){alertMsg('Could not open the folder picker. Enter the full folder path manually.');}};
$('scan-btn').onclick=runScan;
$('apply-threshold').onclick=()=>{$('threshold').value=$('settings-threshold').value;showPage('analysis');alertMsg('Threshold applied to the scanner.','success');};
$('threshold').addEventListener('input',()=>{$('settings-threshold').value=$('threshold').value;});
$('settings-threshold').addEventListener('input',()=>{$('threshold').value=$('settings-threshold').value;});
async function runScan(){
 clearAlert(); const path=$('folder-path').value.trim(); const threshold=Number($('threshold').value);
 if(!path){alertMsg('Choose a folder or enter its full path first.');return;}
 if(!Number.isFinite(threshold)||threshold<0){alertMsg('Enter a valid non-negative threshold in MB.');return;}
 $('scan-btn').disabled=true;$('scan-btn').textContent='Scanning…';$('scan-progress').classList.remove('hidden');$('progress-status').textContent='SCANNING';
 try{
  const response=await fetch('/api/scan',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({path,threshold_mb:threshold})});
  const data=await response.json(); if(!response.ok)throw new Error(data.error||'Scan failed.');
  const full=await fetch('/api/results'); const result=await full.json(); current=result;
  renderAll();$('progress-label').textContent='Scan completed successfully';$('progress-status').textContent='COMPLETE';$('scan-status').textContent='Complete';
  $('scan-files').textContent=data.summary.file_count.toLocaleString();$('scan-folders').textContent=data.summary.folder_count.toLocaleString();$('scan-size').textContent=data.summary.total_size;
  $('scan-errors').classList.toggle('hidden',!data.errors.length);
  if(data.errors.length)$('scan-errors').innerHTML=`Some entries could not be read (${data.errors.length} shown):<ul>${data.errors.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`;
  alertMsg(`Scan complete — ${data.summary.file_count} files analyzed.`, 'success'); showPage('dashboard');
 }catch(err){$('progress-status').textContent='FAILED';$('scan-status').textContent='Failed';alertMsg(err.message);}
 finally{$('scan-btn').disabled=false;$('scan-btn').innerHTML='Start scan <span>→</span>';}
}
function renderAll(){
 const s=current.summary||{}; $('stat-size').textContent=s.total_size||'0 B';$('stat-files').textContent=(s.file_count||0).toLocaleString();$('stat-folders').textContent=(s.folder_count||0).toLocaleString();$('stat-large').textContent=(s.large_count||0).toLocaleString();$('large-subtitle').textContent=`Threshold: ${s.threshold_display||'—'}`;$('chart-total').textContent=s.total_size||'0 B';$('scan-root').textContent=current.root||'No scan performed yet';
 renderCharts();renderTopFiles();renderTips();renderFolders();renderFiles();renderCategories();renderRecommendations();
}
function renderCharts(){
 const cats=Object.entries(current.categories||{}).sort((a,b)=>b[1]-a[1]); const labels=cats.map(x=>x[0]), values=cats.map(x=>x[1]);
 if(categoryChart)categoryChart.destroy();
 categoryChart=new Chart($('categoryChart'),{type:'doughnut',data:{labels,datasets:[{data:values,backgroundColor:palette,borderColor:'#111624',borderWidth:4,hoverOffset:5}]},options:{cutout:'75%',plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>`${c.label}: ${fmt(c.raw)}`}}}}});
 $('category-legend').innerHTML=cats.length?cats.map((x,i)=>`<span class="legend-item"><i class="legend-dot" style="background:${palette[i%palette.length]}"></i>${esc(x[0])}</span>`).join(''):'<span class="legend-item">No category data yet</span>';
 const folders=(current.folders||[]).slice(0,7).reverse();
 if(folderChart)folderChart.destroy();
 folderChart=new Chart($('folderChart'),{type:'bar',data:{labels:folders.map(f=>f.name),datasets:[{data:folders.map(f=>f.size),backgroundColor:'#8872ed',borderRadius:5,barThickness:13}]},options:{indexAxis:'y',maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.raw)}}},scales:{x:{grid:{color:'#252d40'},ticks:{color:'#7e89a0',callback:v=>fmt(v)}},y:{grid:{display:false},ticks:{color:'#aeb7c9',font:{size:9}}}}}});
 if(categoryBarChart)categoryBarChart.destroy();
 categoryBarChart=new Chart($('categoryBarChart'),{type:'bar',data:{labels,datasets:[{label:'Storage',data:values,backgroundColor:palette,borderRadius:5}]},options:{maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.raw)}}},scales:{x:{ticks:{color:'#aeb7c9'},grid:{display:false}},y:{ticks:{color:'#8792a9',callback:v=>fmt(v)},grid:{color:'#252d40'}}}}});
}
function renderTopFiles(){
 const top=(current.files||[]).slice(0,5);
 $('top-files').innerHTML=top.length?top.map(f=>`<div class="compact-item"><div><b title="${esc(f.name)}">${esc(f.name)}</b><small>${esc(f.folder)}</small></div><span class="compact-size">${f.size_display}</span></div>`).join(''):'<div class="empty-state">No files found in this scan.</div>';
}
function renderTips(){
 const tips=current.recommendations||[];
 $('dashboard-tips').innerHTML=tips.slice(0,4).map(t=>`<div class="tip"><span class="tip-icon">✧</span><span>${esc(t)}</span></div>`).join('')||'<div class="empty-state">Run a scan to see insights.</div>';
}
function renderFolders(){
 const q=($('folder-search')?.value||'').toLowerCase(); const list=(current.folders||[]).filter(f=>f.path.toLowerCase().includes(q)).sort((a,b)=>b.size-a.size);const total=current.summary?.total_bytes||0;
 $('folder-table').innerHTML=list.length?list.map(f=>`<tr><td><div class="file-cell"><span class="file-icon">▰</span><div><b>${esc(f.name)}</b><small>${esc(f.path)}</small></div></div></td><td>${f.file_count}</td><td class="size-cell">${f.size_display}</td><td><div class="bar-track"><span style="width:${total?Math.min(100,f.size/total*100):0}%"></span></div></td></tr>`).join(''):'<tr><td colspan="4" class="empty-cell">No matching folders.</td></tr>';
}
$('folder-search').addEventListener('input',renderFolders);
function renderFiles(){
 const q=($('file-search')?.value||'').toLowerCase(),cat=$('category-filter').value,minimum=Number($('minimum-size').value||0)*1024*1024,sort=$('sort-order').value;
 let list=(current.files||[]).filter(f=>(f.name.toLowerCase().includes(q)||f.folder.toLowerCase().includes(q))&&(cat==='all'||f.category===cat)&&f.size>=minimum);
 list.sort((a,b)=>sort==='asc'?a.size-b.size:b.size-a.size);
 $('files-table').innerHTML=list.length?list.map(f=>`<tr><td><div class="file-cell"><span class="file-icon">▤</span><div><b>${esc(f.name)}</b><small>${esc(f.extension)}</small></div></div></td><td><span class="type-tag">${esc(f.category)}</span></td><td class="size-cell">${f.size_display}${f.large?' <span title="Above threshold">✦</span>':''}</td><td title="${esc(f.folder)}">${esc(f.folder)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty-cell">No files match these filters.</td></tr>';
 $('file-count').textContent=`${list.length.toLocaleString()} file(s)`;
 const categories=[...new Set((current.files||[]).map(f=>f.category))].sort();
 const select=$('category-filter'), old=select.value;select.innerHTML='<option value="all">All file types</option>'+categories.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');select.value=categories.includes(old)?old:'all';
}
['file-search','category-filter','minimum-size','sort-order'].forEach(id=>$(id).addEventListener('input',renderFiles));
function renderCategories(){
 const entries=Object.entries(current.categories||{}).sort((a,b)=>b[1]-a[1]),total=current.summary?.total_bytes||0;
 $('category-cards').innerHTML=entries.length?entries.map((x,i)=>`<article class="category-card"><small><i class="legend-dot" style="background:${palette[i%palette.length]}"></i>${esc(x[0])}</small><b>${fmt(x[1])}</b><span>${total?(x[1]/total*100).toFixed(1):0}% of scanned storage</span></article>`).join(''):'<div class="panel empty-state">No category data available.</div>';
}
function renderRecommendations(){
 $('recommendation-list').innerHTML=(current.recommendations||[]).map((t,i)=>`<article class="recommendation"><span class="rec-icon">${i===0?'↗':'✧'}</span><p>${esc(t)}</p></article>`).join('')||'<div class="panel empty-state">Run a scan to generate recommendations.</div>';
}
async function loadHistory(){
 try{const r=await fetch('/api/history'),d=await r.json();$('history-table').innerHTML=d.history.length?d.history.map(h=>`<tr><td>${esc(h.scanned_at)}</td><td title="${esc(h.root)}">${esc(h.root)}</td><td class="size-cell">${fmt(h.total_bytes)}</td><td>${h.file_count}</td><td>${h.large_count}</td></tr>`).join(''):'<tr><td colspan="5" class="empty-cell">No scan history yet.</td></tr>';}catch(e){alertMsg('Could not load scan history.');}
}
window.addEventListener('load',()=>{const p=location.hash.replace('#','');if(p&&$('page-'+p))showPage(p);});
