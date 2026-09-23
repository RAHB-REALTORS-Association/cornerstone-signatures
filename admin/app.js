const main = document.querySelector('#main');
const nav = document.querySelector('#nav');
const identity = document.querySelector('#identity');
const dialog = document.querySelector('#dialog');
const dialogContent = document.querySelector('#dialog-content');

const state = { session: null, users: [], audiences: [], taglines: [], mergeTags: { builtIns: [], customTags: [] }, templates: [], deployments: [], scheduledDeployments: [], audit: [], directorySync: null, manageSettings: null, route: 'dashboard' };
const API = '/api/admin';
const routes = [
  ['dashboard', 'dashboard', 'Dashboard', 'all'],
  ['users', 'users', 'Staff & access', 'it_admin'],
  ['templates', 'template', 'Signature templates', 'communications_editor'],
  ['merge-tags', 'tags', 'Tags', 'communications_editor'],
  ['audiences', 'audiences', 'Audiences', ['it_admin', 'communications_editor']],
  ['taglines', 'tagline', 'Taglines editor', 'communications_editor'],
  ['deployments', 'send', 'Deployments', 'all'],
  ['audit', 'audit', 'Audit log', 'it_admin'],
  ['manage', 'manage', 'Manage', 'it_admin']
];

const iconPaths = {
  dashboard: ['M3 3h7v7H3z','M14 3h7v4h-7z','M14 11h7v10h-7z','M3 14h7v7H3z'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2','M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z','M22 21v-2a4 4 0 0 0-3-3.87','M16 3.13a4 4 0 0 1 0 7.75'],
  audiences: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z','M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12z','M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z'],
  tagline: ['M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z','M8 8h8','M8 12h5'],
  tags: ['M20 13 11 22 2 13V4a2 2 0 0 1 2-2h9z','M7.5 7.5h.01'],
  template: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z','M14 2v6h6','M16.5 13.5 11 19l-3 1 1-3 5.5-5.5a1.4 1.4 0 0 1 2 2z'],
  send: ['M22 2 11 13','m22 2-7 20-4-9-9-4z'],
  audit: ['M9 11h6','M9 15h6','M9 7h3','M5 3h14a2 2 0 0 1 2 2v16H3V5a2 2 0 0 1 2-2z'],
  manage: ['M4 6h16','M4 12h16','M4 18h16','M8 3v6','M16 9v6','M10 15v6']
};

function navIcon(name) {
  const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  Object.entries({class:'nav-icon',viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.9','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'}).forEach(([key,value])=>svg.setAttribute(key,value));
  (iconPaths[name]||[]).forEach(d=>{const path=document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',d);svg.append(path);});
  return svg;
}

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([key, value]) => {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'checked' || key === 'disabled' || key === 'selected') node[key] = Boolean(value);
    else if (value !== undefined && value !== null) node.setAttribute(key, String(value));
  });
  children.flat().forEach(child => node.append(child instanceof Node ? child : document.createTextNode(String(child))));
  return node;
}

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'Accept':'application/json', ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers }, ...options });
  if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error?.message || body.message || (typeof body.error === 'string' ? body.error : '') || `${response.status} ${response.statusText}`); }
  return response.status === 204 ? null : response.json();
}
const list = payload => Array.isArray(payload) ? payload : payload?.items || payload?.users || payload?.audiences || payload?.taglines || payload?.templates || payload?.deployments || payload?.events || [];
const roles = () => new Set(state.session?.roles || (state.session?.role ? [state.session.role] : []));
const can = role => roles().has(role);
const canAccess = permission => permission === 'all' || (Array.isArray(permission) ? permission.some(can) : can(permission));
const initials = value => String(value || '?').split(/\s+/).slice(0,2).map(s => s[0]).join('').toUpperCase();
const userName = user => user.displayName || user.name || [user.first_name, user.last_name].filter(Boolean).join(' ') || user.email || 'Unnamed user';
const date = value => value ? new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(new Date(value)) : '—';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const humanize = value => String(value || '').replace(/[._-]+/g,' ').replace(/\b\w/g,letter=>letter.toUpperCase());

function avatar(user, className='initial') {
  const fallback=el('span',{class:className},initials(userName(user)));
  if (!user?.photo_data_url) return fallback;
  const photo=el('img',{class:`${className} profile-photo`,src:user.photo_data_url,alt:'',loading:'lazy',referrerpolicy:'no-referrer'});
  photo.addEventListener('error',()=>photo.replaceWith(fallback),{once:true});
  return photo;
}

function toast(message, type='') { const item=el('div',{class:`toast ${type}`,role:'status'},message); document.querySelector('#toast-region').append(item); setTimeout(()=>item.remove(),4500); }
function loading() { main.replaceChildren(el('div',{class:'card state'},el('div',{},el('div',{class:'loader','aria-label':'Loading'}),el('p',{},'Loading workspace…')))); }
function errorState(error, retry) { main.replaceChildren(el('div',{class:'card state'},el('div',{},el('div',{class:'state-icon'},'!'),el('h2',{},'We couldn’t load this view'),el('p',{},error.message),el('button',{class:'button primary',type:'button',onclick:retry},'Try again')))); }
function emptyRow(columns, message) { return el('tr',{},el('td',{class:'empty-cell',colspan:columns},message)); }
function pageHead(title, description, action) { return el('div',{class:'page-head'},el('div',{},el('h1',{},title),el('p',{},description)),action || ''); }
function badge(text, kind='') { return el('span',{class:`badge ${kind}`},el('i',{class:'dot'}),text); }
function onboardingTip(id,title,message) {
  const email=state.session?.user?.email||state.session?.email||'anonymous';
  const key=`cornerstone-signatures:onboarding:${email}:${id}:v2`;
  try { if(localStorage.getItem(key)==='dismissed')return document.createDocumentFragment(); } catch {}
  const tip=el('aside',{class:'onboarding-tip',role:'note'},el('span',{class:'onboarding-icon','aria-hidden':'true'},'i'),el('div',{},el('strong',{},title),el('p',{},message)));
  const dismiss=el('button',{class:'onboarding-dismiss',type:'button','aria-label':`Dismiss ${title}`,onclick:()=>{try{localStorage.setItem(key,'dismissed');}catch{}tip.remove();}},'×');
  tip.append(dismiss);
  return tip;
}
function showDialog(content) {
  content.querySelectorAll('button[value="cancel"]').forEach(button=>{button.type='button';button.addEventListener('click',()=>dialog.close());});
  dialogContent.replaceChildren(content);
  dialog.showModal();
}

function renderNav() {
  nav.replaceChildren();
  routes.forEach(([id,icon,label,permission], index) => {
    if (!canAccess(permission)) return;
    if (index === 1) nav.append(el('div',{class:'nav-section'},'Manage'));
    const link=el('a',{href:`#${id}`,'aria-current':state.route===id?'page':null},navIcon(icon),label);
    nav.append(link);
  });
}

function renderIdentity() {
  const user=state.session?.user || state.session || {};
  identity.replaceChildren(avatar(user,'avatar'),el('span',{},el('b',{},userName(user)),el('small',{},roles().has('it_admin')?'IT administrator':'Communications editor')));
}

function renderBranding() {
  const name=state.session?.branding?.organizationName;
  if(name)document.querySelector('.sidebar-foot p').textContent=name;
}

async function loadSession() {
  try { state.session=await api(`${API}/session`); renderIdentity(); renderBranding(); navigate(); }
  catch(error) { errorState(error,loadSession); }
}

async function navigate() {
  state.route=(location.hash.slice(1).split('/')[0] || 'dashboard');
  const route=routes.find(r=>r[0]===state.route) || routes[0];
  if (!canAccess(route[3])) { state.route='dashboard'; location.hash='dashboard'; toast('You do not have access to that area.','error'); }
  renderNav(); loading();
  try { await ({dashboard,users,audiences,taglines,'merge-tags':mergeTags,templates,deployments,audit,manage}[state.route] || dashboard)(); }
  catch(error) { errorState(error,navigate); }
  setSidebarOpen(false);
}

async function dashboard() {
  const results=await Promise.allSettled([api(`${API}/users`),api(`${API}/templates`),api(`${API}/deployments`),api(`${API}/audit`),api(`${API}/dashboard`)]);
  [state.users,state.templates,state.deployments,state.audit]=results.slice(0,4).map(r=>r.status==='fulfilled'?list(r.value):[]);
  const signaturesSigned=results[4].status==='fulfilled'?Number(results[4].value?.signaturesSigned)||0:0;
  const analytics=results[4].status==='fulfilled'?results[4].value?.analytics||{}:{};
  const applicable=state.users.filter(u=>u.signature_enabled ?? u.applicable ?? u.signatureEnabled ?? u.visible).length;
  const published=new Set(state.deployments.filter(d=>d.status==='published').map(d=>d.template_id)).size;
  const healthy=state.deployments.filter(d=>['published','success','deployed','healthy','complete'].includes(String(d.status).toLowerCase())).length;
  const metrics=el('div',{class:'grid metrics'},
    metric('Managed staff',state.users.length,`${applicable} eligible for signatures`),metric('Signatures Signed',signaturesSigned.toLocaleString(),'Managed signatures delivered to Outlook'),metric('Published templates',published,`${state.templates.length} total versions`),metric('Active deployments',healthy,`${state.deployments.length} recorded`),metric('Recent changes',state.audit.length,'In the current audit window'));
  const recent=state.audit.slice(0,6);
  const activityItems = recent.length
    ? el('ul', {class:'activity'}, ...recent.map(a => el('li', {},
        el('i'),
        el('p', {}, el('strong', {}, a.actor_email || a.actorName || a.actor || 'System'), ' ', a.description || a.action || 'made a change'),
        el('time', {}, date(a.created_at || a.createdAt || a.timestamp))
      )))
    : el('div', {class:'state'}, el('p', {}, 'No recent activity.'));
  const activity = el('section', {class:'card'},
    el('div', {class:'section-head'},
      el('div', {}, el('h3', {}, 'Recent activity'), el('p', {}, 'Administrative changes across Cornerstone Signatures')),
      can('it_admin') ? el('a', {class:'button small', href:'#audit'}, 'View audit log') : ''
    ),
    activityItems
  );
  const coverage=state.users.length?Math.round(applicable/state.users.length*100):0;
  const readiness=el('section',{class:'card card-pad stack'},el('div',{},el('h3',{},'Deployment readiness'),el('p',{class:'muted'},'Staff currently covered by an active signature policy.')),el('div',{class:'split-row'},el('strong',{},`${coverage}% coverage`),el('span',{class:'muted'},`${applicable} of ${state.users.length}`)),el('div',{class:'progress','aria-label':`${coverage}% coverage`},el('span',{style:`width:${coverage}%`})),el('a',{class:'button',href:'#deployments'},'Review deployments'));
  const analyticsPeriod=`Last ${Number(analytics.periodDays)||30} days`;
  const clientRows=(analytics.clients||[]).map(item=>el('li',{},el('span',{},el('strong',{},item.family||'Unknown client'),el('small',{class:'muted block'},[item.platform,item.version&&`version ${item.version}`].filter(Boolean).join(' · '))),el('b',{},Number(item.count||0).toLocaleString())));
  const usageLabels={primary:'Primary address',alternate_from:'Alternate From (send-as, delegated, or shared)'};
  const usageRows=(analytics.usage||[]).map(item=>el('li',{},el('span',{},usageLabels[item.type]||item.type),el('b',{},Number(item.count||0).toLocaleString())));
  const clientFamilyMap=(analytics.clients||[]).reduce((entries,item)=>{const key=item.family||'Unknown client';const current=entries.get(key)||{label:key,count:0};current.count+=Number(item.count)||0;entries.set(key,current);return entries;},new Map());
  const clientFamilies=[...clientFamilyMap.values()];
  const clientChart=pieChart(clientFamilies,'Outlook client family distribution');
  const usageChart=pieChart((analytics.usage||[]).map(item=>({label:usageLabels[item.type]||item.type,count:Number(item.count)||0})),'Primary and alternate From-address distribution');
  const clients=el('section',{class:'card card-pad stack analytics-card'},el('div',{},el('h3',{},'Outlook clients'),el('p',{class:'muted'},`${analyticsPeriod} · Successful managed signature deliveries`)),clientRows.length?el('div',{class:'analytics-chart-layout'},clientChart,el('div',{},el('p',{class:'muted analytics-detail-label'},'Platform and version detail'),el('ul',{class:'analytics-list'},...clientRows))):el('p',{class:'muted'},'Client analytics will appear after new signatures are delivered.'));
  const fromUsage=el('section',{class:'card card-pad stack analytics-card'},el('div',{},el('h3',{},'From-address usage'),el('p',{class:'muted'},`${analyticsPeriod} · Primary versus alternate sending`)),usageRows.length?usageChart:el('p',{class:'muted'},'From-address analytics will appear after new signatures are delivered.'));
  main.replaceChildren(pageHead('Good to see you', 'Monitor signature coverage and make controlled changes across your organization.'),metrics,el('div',{class:'grid two dashboard-grid'},activity,readiness),el('div',{class:'grid two dashboard-grid'},clients,fromUsage));
}
function metric(label,value,note){return el('article',{class:'card metric'},el('span',{class:'label'},label),el('strong',{},value),el('small',{},note));}
function pieChart(items,ariaLabel){
  const palette=['#2563eb','#16a34a','#f59e0b','#7c3aed','#0891b2','#dc2626','#4f46e5','#64748b'];
  const values=items.filter(item=>Number(item.count)>0);const total=values.reduce((sum,item)=>sum+Number(item.count),0);let cursor=0;
  const stops=values.map((item,index)=>{const start=cursor;cursor+=Number(item.count)/total*100;return `${palette[index%palette.length]} ${start}% ${cursor}%`;});
  const chart=el('div',{class:'pie-chart',style:`background:conic-gradient(${stops.join(',')})`,role:'img','aria-label':`${ariaLabel}: ${values.map(item=>`${item.label} ${item.count}`).join(', ')}`},el('span',{},total.toLocaleString(),el('small',{},'deliveries')));
  const legend=el('ul',{class:'pie-legend'},...values.map((item,index)=>el('li',{},el('i',{style:`background:${palette[index%palette.length]}`}),el('span',{},item.label),el('b',{},`${Math.round(Number(item.count)/total*100)}%`))));
  return el('div',{class:'pie-wrap'},chart,legend);
}

async function users() {
  const [usersPayload,syncPayload]=await Promise.all([api(`${API}/users`),api(`${API}/directory-sync`)]);
  state.users=list(usersPayload); state.directorySync=syncPayload;
  const viewKey=`cornerstone-signatures:staff-view:${state.session?.user?.email||state.session?.email||'anonymous'}:v1`;
  let savedView={};
  try { savedView=JSON.parse(localStorage.getItem(viewKey)||'{}'); } catch {}
  const savedFacet=(name)=>Array.isArray(savedView[name])
    ? new Set(savedView[name].filter(value=>typeof value==='boolean'))
    : new Set([true,false]);
  const sortableKeys=new Set(['name','title','office','phone','applicable','visible','role']);
  const selected=new Set();
  const body=el('tbody');
  const selectAll=el('input',{type:'checkbox','aria-label':'Select all filtered staff'});
  const bulkCount=el('strong',{},'0 selected');
  const applicabilityChoice=el('select',{'aria-label':'Set signature applicability'},el('option',{value:''},'Signature: no change'),el('option',{value:'true'},'Signature: applicable'),el('option',{value:'false'},'Signature: N/A'));
  const visibilityChoice=el('select',{'aria-label':'Set picker visibility'},el('option',{value:''},'Picker: no change'),el('option',{value:'true'},'Picker: visible'),el('option',{value:'false'},'Picker: hidden'));
  const optOutChoice=el('select',{'aria-label':'Set self-service opt-out permission'},el('option',{value:''},'Self opt-out: no change'),el('option',{value:'true'},'Self opt-out: allow'),el('option',{value:'false'},'Self opt-out: deny'));
  const taglineChoice=el('select',{'aria-label':'Set tagline choice permission'},el('option',{value:''},'Tagline choice: no change'),el('option',{value:'true'},'Tagline choice: allow'),el('option',{value:'false'},'Tagline choice: deny'));
  const identityChoice=el('select',{'aria-label':'Set signature identity'},el('option',{value:''},'Identity: no change'),el('option',{value:'signed_in'},'Identity: signed-in employee'),el('option',{value:'mailbox'},'Identity: this account'));
  const applyBulk=el('button',{class:'button small primary',type:'button',disabled:true,onclick:()=>bulkUpdate()},'Apply changes');
  const editDetails=el('button',{class:'button small',type:'button',onclick:()=>bulkDetailsDialog(state.users.filter(user=>selected.has(user.id)),()=>render(search.value))},'Edit details');
  const deleteSelected=el('button',{class:'button small danger-outline',type:'button',onclick:()=>confirmDeleteStaff(state.users.filter(user=>selected.has(user.id)),()=>{selected.clear();render(search.value);})},'Delete selected');
  const bulkBar=el('div',{class:'bulk-bar',hidden:true},bulkCount,el('div',{class:'bulk-actions'},editDetails,applicabilityChoice,visibilityChoice,optOutChoice,taglineChoice,identityChoice,applyBulk,deleteSelected,el('button',{class:'button small subtle',type:'button',onclick:()=>{selected.clear();render(search.value);}},'Clear selection')));
  const sortState={key:sortableKeys.has(savedView.sortKey)?savedView.sortKey:'name',direction:savedView.sortDirection==='desc'?'desc':'asc'};
  const sortHeaders=[];
  const sortableHeader=(label,key)=>{const button=el('button',{class:'sort-button',type:'button',onclick:()=>{if(sortState.key===key)sortState.direction=sortState.direction==='asc'?'desc':'asc';else{sortState.key=key;sortState.direction='asc';}render(search.value);}},label);const header=el('th',{},button);sortHeaders.push({header,button,label,key});return header;};
  const table=el('table',{class:'table staff-table'},el('thead',{},el('tr',{},el('th',{class:'select-cell'},selectAll),sortableHeader('Staff member','name'),sortableHeader('Job title','title'),sortableHeader('Office','office'),sortableHeader('Phone','phone'),sortableHeader('Signature','applicable'),sortableHeader('Picker','visible'),sortableHeader('Role','role'),el('th',{}))),body);
  let visibleMatches=[];
  const roleLabel=user=>user.roles?.includes('it_admin')?'IT administrator':user.roles?.includes('communications_editor')?'Communications':'Staff';
  const updateApplyState=()=>{applyBulk.disabled=!selected.size||(!applicabilityChoice.value&&!visibilityChoice.value&&!optOutChoice.value&&!taglineChoice.value&&!identityChoice.value);};
  const updateSelection=()=>{
    const selectedVisible=visibleMatches.filter(u=>selected.has(u.id)).length;
    selectAll.checked=visibleMatches.length>0&&selectedVisible===visibleMatches.length;
    selectAll.indeterminate=selectedVisible>0&&selectedVisible<visibleMatches.length;
    bulkCount.textContent=`${selected.size} selected`;
    bulkBar.hidden=selected.size===0;
    const selectedUsers=state.users.filter(user=>selected.has(user.id));
    const protectedSelection=selectedUsers.some(user=>user.deletable===false||user.email?.toLowerCase()===state.session?.email?.toLowerCase());
    deleteSelected.disabled=!selected.size||protectedSelection;
    deleteSelected.title=protectedSelection?'Environment-seeded administrators and your signed-in account cannot be deleted.':'';
    updateApplyState();
  };
  const bulkUpdate=async()=>{if(!selected.size)return;const changes={};if(applicabilityChoice.value)changes.applicable=applicabilityChoice.value==='true';if(visibilityChoice.value)changes.visible=visibilityChoice.value==='true';if(optOutChoice.value)changes.canSelfOptOut=optOutChoice.value==='true';if(taglineChoice.value)changes.canChooseTagline=taglineChoice.value==='true';if(identityChoice.value)changes.signatureIdentityMode=identityChoice.value;if(!Object.keys(changes).length)return;try{bulkBar.querySelectorAll('button,select').forEach(control=>control.disabled=true);const count=selected.size;const response=await api(`${API}/users`,{method:'PATCH',body:JSON.stringify({ids:[...selected],...changes})});const updated=new Map(list(response).map(user=>[user.id,user]));state.users=state.users.map(user=>updated.get(user.id)||user);applicabilityChoice.value='';visibilityChoice.value='';optOutChoice.value='';taglineChoice.value='';identityChoice.value='';render(search.value);toast(`Updated ${count} selected account${count===1?'':'s'}.`);}catch(error){toast(error.message,'error');}finally{bulkBar.querySelectorAll('button,select').forEach(control=>control.disabled=false);updateSelection();}};
  const filterState={applicable:savedFacet('applicable'),visible:savedFacet('visible')};
  const filterSummary=el('summary',{class:'button filter-summary'},'Filters');
  const filterMenu=el('details',{class:'filter-menu'},filterSummary);
  const closeFilterMenu=event=>{if(filterMenu.open&&!filterMenu.contains(event.target))filterMenu.open=false;};
  const closeFilterMenuOnEscape=event=>{if(filterMenu.open&&event.key==='Escape'){filterMenu.open=false;filterSummary.focus();}};
  filterMenu.addEventListener('toggle',()=>{
    if(filterMenu.open){document.addEventListener('pointerdown',closeFilterMenu);document.addEventListener('keydown',closeFilterMenuOnEscape);}
    else{document.removeEventListener('pointerdown',closeFilterMenu);document.removeEventListener('keydown',closeFilterMenuOnEscape);}
  });
  const filterOption=(label,facet,value)=>{const input=el('input',{type:'checkbox',checked:filterState[facet].has(value)});input.addEventListener('change',()=>{input.checked?filterState[facet].add(value):filterState[facet].delete(value);render(search.value);});return el('label',{},input,el('span',{},label));};
  const resetFilters=el('button',{class:'button small subtle',type:'button',onclick:()=>{filterState.applicable=new Set([true,false]);filterState.visible=new Set([true,false]);filterMenu.querySelectorAll('input').forEach(input=>{input.checked=true;});render(search.value);}},'Reset');
  filterMenu.append(el('div',{class:'filter-popover'},el('div',{class:'filter-heading'},el('strong',{},'Filter staff'),resetFilters),el('fieldset',{},el('legend',{},'Signature'),filterOption('Applicable','applicable',true),filterOption('N/A','applicable',false)),el('fieldset',{},el('legend',{},'Picker visibility'),filterOption('Visible','visible',true),filterOption('Hidden','visible',false))));
  const staffCount=el('p',{},`${state.users.length} managed accounts`);
  const persistView=(query)=>{try{localStorage.setItem(viewKey,JSON.stringify({query,applicable:[...filterState.applicable],visible:[...filterState.visible],sortKey:sortState.key,sortDirection:sortState.direction}));}catch{}};
  const render=(query='')=>{
    persistView(query);
    const activeFilters=(filterState.applicable.size<2?1:0)+(filterState.visible.size<2?1:0);
    filterSummary.textContent=activeFilters?`Filters · ${activeFilters}`:'Filters';
    filterSummary.classList.toggle('active',Boolean(activeFilters));
    body.replaceChildren(); visibleMatches=state.users.filter(u=>`${userName(u)} ${u.email} ${u.title||''} ${u.office_location||''} ${u.phone||''}`.toLowerCase().includes(query.toLowerCase())&&filterState.applicable.has(Boolean(u.applicable??u.signatureEnabled??u.visible))&&filterState.visible.has(Boolean(u.visible)));
    staffCount.textContent=`${state.users.length} managed accounts (${visibleMatches.length} shown)`;
    const value=(user,key)=>key==='name'?userName(user):key==='title'?(user.title||''):key==='office'?(user.office_location||''):key==='phone'?(user.phone||''):key==='applicable'?Number(Boolean(user.applicable)):key==='visible'?Number(Boolean(user.visible)):roleLabel(user);
    visibleMatches.sort((a,b)=>{const left=value(a,sortState.key),right=value(b,sortState.key);const result=typeof left==='number'?left-right:String(left).localeCompare(String(right),undefined,{numeric:true,sensitivity:'base'});return sortState.direction==='asc'?result:-result;});
    sortHeaders.forEach(({header,button,label,key})=>{const active=sortState.key===key;header.setAttribute('aria-sort',active?(sortState.direction==='asc'?'ascending':'descending'):'none');button.textContent=`${label}${active?(sortState.direction==='asc'?' ▲':' ▼'):''}`;});
    if(!visibleMatches.length){body.append(emptyRow(9,'No staff members match these filters.'));updateSelection();return;}
    visibleMatches.forEach(u=>{const eligible=Boolean(u.signature_enabled??u.applicable??u.signatureEnabled??u.visible);const visible=Boolean(u.visible);const userRoles=u.roles||[];const detail=(value,overridden)=>{const cell=el('span',{},value||'—');if(overridden)cell.append(' ',badge('Override','warning'));return cell;};const rowSelect=el('input',{type:'checkbox',checked:selected.has(u.id),'aria-label':`Select ${userName(u)}`,onchange:()=>{rowSelect.checked?selected.add(u.id):selected.delete(u.id);updateSelection();}});body.append(el('tr',{class:selected.has(u.id)?'selected-row':''},el('td',{class:'select-cell'},rowSelect),el('td',{},el('div',{class:'person'},avatar(u),el('span',{},el('strong',{},userName(u)),el('small',{},u.email||u.userPrincipalName||'')))),el('td',{},detail(u.title,u.title_override)),el('td',{},detail(u.office_location,u.office_location_override)),el('td',{},detail(u.phone,u.phone_override)),el('td',{},badge(eligible?'Applicable':u.self_opted_out?'Opted out':'N/A',eligible?'success':'warning')),el('td',{},badge(visible?'Visible':'Hidden',visible?'info':'')),el('td',{},userRoles.length?badge(roleLabel(u),'info'):el('span',{class:'muted'},roleLabel(u))),el('td',{},el('div',{class:'actions'},el('button',{class:'button small',type:'button',onclick:()=>previewUser(u)},'Preview'),el('button',{class:'button small',type:'button',onclick:()=>editUser(u)},'Manage')))));});updateSelection();
  };
  const search=el('input',{type:'search',placeholder:'Search staff details','aria-label':'Search staff',value:typeof savedView.query==='string'?savedView.query:''});
  [applicabilityChoice,visibilityChoice,optOutChoice,taglineChoice,identityChoice].forEach(control=>control.addEventListener('change',updateApplyState));
  selectAll.addEventListener('change',()=>{visibleMatches.forEach(user=>selectAll.checked?selected.add(user.id):selected.delete(user.id));render(search.value);});
  search.addEventListener('input',()=>render(search.value)); render(search.value);
  const syncAction=el('a',{class:'button primary',href:'#manage'},'Manage Entra sync');
  const syncNote=state.directorySync?.configured?'Microsoft Graph application credentials connected':'Microsoft Graph credentials still need to be added to Coolify';
  main.replaceChildren(pageHead('Staff & access','Control who is visible, who receives signatures, and who may edit templates.',syncAction),onboardingTip('managed-directory','Persistent managed directory',`${syncNote}. Entra refreshes source data; visibility, applicability, roles, and profile overrides remain under IT control.`),el('section',{class:'card'},el('div',{class:'section-head'},el('div',{},el('h3',{},'Directory users'),staffCount)),el('div',{class:'toolbar'},el('label',{class:'search'},search),filterMenu),bulkBar,el('div',{class:'table-wrap'},table)));
}

async function audiences() {
  const [audiencePayload,userPayload]=await Promise.all([api(`${API}/audiences`),api(`${API}/users`)]);
  state.audiences=list(audiencePayload);state.users=list(userPayload);
  const body=el('tbody');
  state.audiences.forEach(audience=>body.append(el('tr',{},el('td',{},el('strong',{},audience.name),audience.description?el('small',{class:'muted block'},audience.description):''),el('td',{},`${audience.member_count} member${audience.member_count===1?'':'s'}`),el('td',{},date(audience.updated_at)),el('td',{},el('div',{class:'actions'},el('button',{class:'button small danger',type:'button',onclick:()=>deleteAudienceDialog(audience)},'Delete'),el('button',{class:'button small',type:'button',onclick:()=>audienceEditor(audience)},'Manage'))))));
  if(!state.audiences.length)body.append(emptyRow(4,'No limited audiences have been created. The default deployment still applies to all applicable staff.'));
  main.replaceChildren(pageHead('Audiences','Create reusable staff groups for targeted signature deployments.',el('button',{class:'button primary',type:'button',onclick:()=>audienceEditor()},'New audience')),onboardingTip('audience-membership','Shared audience management','IT administrators and Communications editors can create audiences and manage their membership. Staff must also remain signature-applicable to receive any deployment.'),el('section',{class:'card'},el('div',{class:'section-head'},el('div',{},el('h3',{},'Limited audiences'),el('p',{},`${state.audiences.length} reusable group${state.audiences.length===1?'':'s'}`))),el('div',{class:'table-wrap'},el('table',{class:'table audience-table'},el('thead',{},el('tr',{},...['Audience','Members','Updated',''].map(value=>el('th',{},value)))),body))));
}

function audienceEditor(audience={}) {
  const selected=new Set(audience.member_ids||[]);
  const name=el('input',{value:audience.name||'',maxlength:100,placeholder:'e.g. Leadership team'});
  const description=el('textarea',{maxlength:500,placeholder:'What is this audience used for?'},audience.description||'');
  const search=el('input',{type:'search',placeholder:'Search staff','aria-label':'Search staff for this audience'});
  const count=el('strong',{},'');
  const selectAll=el('input',{type:'checkbox','aria-label':'Select all filtered staff'});
  const memberBody=el('tbody');
  let matches=[];
  const render=()=>{
    matches=state.users.filter(user=>`${userName(user)} ${user.email} ${user.title||''} ${user.office_location||''}`.toLowerCase().includes(search.value.toLowerCase()));
    memberBody.replaceChildren();
    matches.forEach(user=>{const checkbox=el('input',{type:'checkbox',checked:selected.has(user.id),'aria-label':`Add ${userName(user)} to audience`,onchange:()=>{checkbox.checked?selected.add(user.id):selected.delete(user.id);render();}});memberBody.append(el('tr',{class:selected.has(user.id)?'selected-row':''},el('td',{class:'select-cell'},checkbox),el('td',{},el('strong',{},userName(user)),el('small',{class:'muted block'},user.email)),el('td',{},user.title||'—'),el('td',{},badge(user.applicable?'Applicable':'N/A',user.applicable?'success':'warning'))));});
    if(!matches.length)memberBody.append(emptyRow(4,'No staff members match this search.'));
    const selectedVisible=matches.filter(user=>selected.has(user.id)).length;
    selectAll.checked=matches.length>0&&selectedVisible===matches.length;selectAll.indeterminate=selectedVisible>0&&selectedVisible<matches.length;
    count.textContent=`${selected.size} member${selected.size===1?'':'s'} selected`;
  };
  search.addEventListener('input',render);selectAll.addEventListener('change',()=>{matches.forEach(user=>selectAll.checked?selected.add(user.id):selected.delete(user.id));render();});
  const save=el('button',{class:'button primary',type:'button',onclick:async()=>{if(!name.value.trim()){toast('Enter an audience name.','error');name.focus();return;}try{save.disabled=true;const method=audience.id?'PUT':'POST';await api(audience.id?`${API}/audiences/${encodeURIComponent(audience.id)}`:`${API}/audiences`,{method,body:JSON.stringify({name:name.value.trim(),description:description.value.trim(),memberIds:[...selected]})});dialog.close();toast(audience.id?'Audience updated.':'Audience created.');audiences();}catch(error){toast(error.message,'error');save.disabled=false;}}},audience.id?'Save audience':'Create audience');
  const table=el('table',{class:'table audience-member-table'},el('thead',{},el('tr',{},el('th',{class:'select-cell'},selectAll),el('th',{},'Staff member'),el('th',{},'Job title'),el('th',{},'Signature'))),memberBody);
  render();
  showDialog(el('div',{class:'dialog-body audience-dialog'},el('h2',{},audience.id?'Manage audience':'New audience'),el('p',{},'Select the staff who should receive signatures targeted to this audience.'),el('div',{class:'form-grid'},el('div',{class:'field'},el('label',{},'Audience name'),name),el('div',{class:'field'},el('label',{},'Description'),description)),el('div',{class:'audience-member-head'},count,el('label',{class:'search'},search)),el('div',{class:'table-wrap audience-members'},table),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),save)));
}

function deleteAudienceDialog(audience) {
  const remove=el('button',{class:'button danger',type:'button',disabled:audience.actively_deployed||audience.pending_schedule,onclick:async()=>{try{remove.disabled=true;await api(`${API}/audiences/${encodeURIComponent(audience.id)}`,{method:'DELETE'});dialog.close();toast('Audience deleted. Deployment history has been preserved.');audiences();}catch(error){toast(error.message,'error');remove.disabled=audience.actively_deployed||audience.pending_schedule;}}},'Delete audience');
  const warning=audience.actively_deployed
    ? el('div',{class:'danger-note'},el('strong',{},'This audience has an active signature.'),el('p',{},'Unpublish it from Deployments before deleting the audience.'))
    : audience.pending_schedule?el('div',{class:'danger-note'},el('strong',{},'This audience has a pending deployment.'),el('p',{},'Cancel it from Deployments before deleting the audience.'))
    : el('div',{class:'danger-note'},el('strong',{},`${audience.member_count} membership assignment${audience.member_count===1?'':'s'} will be removed.`),el('p',{},'Past deployments and audit history will retain this audience’s name.'));
  showDialog(el('div',{class:'dialog-body database-confirm'},el('h2',{},`Delete ${audience.name}?`),el('p',{},'The audience will no longer be available for future signature publishing.'),warning,el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),remove)));
}

async function previewUser(user) {
  try {
    const preview=await api(`${API}/users/${encodeURIComponent(user.id)}/signature-preview`);
    const frame=el('iframe',{title:`Signature preview for ${userName(user)}`,sandbox:''});
    frame.srcdoc=preview.html;
    const delivery=user.visible&&user.applicable?badge('Eligible for delivery','success'):badge('Not currently delivered','warning');
    const deploymentDetail=preview.source==='published'?` · ${preview.audienceName} · Priority ${preview.priority}`:'';
    showDialog(el('div',{class:'dialog-body'},el('h2',{},`Signature for ${userName(user)}`),el('p',{},`${preview.templateName} · Revision ${preview.revision} · ${preview.source==='published'?'Published version':'Draft fallback'}${deploymentDetail}`),el('div',{class:'preview-status'},delivery,preview.source==='published'?badge('Published','success'):badge('Draft','warning')),el('div',{class:'preview-shell signature-preview-shell'},frame),el('div',{class:'dialog-actions'},el('button',{class:'button primary',value:'cancel'},'Close'))));
  } catch(error) { toast(error.message,'error'); }
}

function bulkDetailsDialog(users,onSaved) {
  const rows=users.map(user=>{
    const title=el('input',{value:user.title||'',maxlength:200,'aria-label':`Job title for ${userName(user)}`});
    const office=el('input',{value:user.office_location||'',maxlength:200,list:'office-location-options','aria-label':`Office location for ${userName(user)}`});
    const phone=el('input',{value:user.phone||'',maxlength:100,'aria-label':`Business phone for ${userName(user)}`});
    return {user,title,office,phone};
  });
  const sourceOverride=(value,source)=>{const normalized=value.trim();return normalized===(source||'').trim()?null:normalized||null;};
  const body=el('tbody',{},...rows.map(({user,title,office,phone})=>el('tr',{},el('td',{},el('strong',{},userName(user)),el('small',{class:'muted block'},user.email)),el('td',{},title),el('td',{},office),el('td',{},phone))));
  const datalist=el('datalist',{id:'office-location-options'});
  const save=async()=>{try{const profiles=rows.map(({user,title,office,phone})=>({id:user.id,titleOverride:sourceOverride(title.value,user.directory_title),officeLocationOverride:sourceOverride(office.value,user.directory_office_location),phoneOverride:sourceOverride(phone.value,user.directory_phone)}));const response=await api(`${API}/users/profiles`,{method:'PATCH',body:JSON.stringify({profiles})});const updated=new Map(list(response).map(user=>[user.id,user]));state.users=state.users.map(user=>updated.get(user.id)||user);dialog.close();onSaved?.();toast(`Saved details for ${rows.length} account${rows.length===1?'':'s'}.`);}catch(error){toast(error.message,'error');}};
  showDialog(el('div',{class:'dialog-body bulk-details'},el('h2',{},'Edit staff details'),el('p',{},'Edit straight down the grid and save once. Values that match Entra remain linked; changed values become Cornerstone Signatures overrides.'),datalist,el('div',{class:'table-wrap'},el('table',{class:'table edit-grid'},el('thead',{},el('tr',{},...['Staff member','Job title','Office location','Business phone'].map(label=>el('th',{},label)))),body)),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),el('button',{class:'button primary',type:'button',onclick:save},'Save all details'))));
}

function confirmDeleteStaff(users,onDeleted) {
  if(!users.length)return;
  const count=users.length;
  const names=users.slice(0,5).map(user=>userName(user));
  const summary=count===1?names[0]:`${names.join(', ')}${count>5?` and ${count-5} more`:''}`;
  const remove=el('button',{class:'button danger',type:'button',onclick:async()=>{try{remove.disabled=true;remove.textContent='Deleting…';await api(`${API}/users`,{method:'DELETE',body:JSON.stringify({ids:users.map(user=>user.id)})});const deletedIds=new Set(users.map(user=>user.id));state.users=state.users.filter(user=>!deletedIds.has(user.id));dialog.close();onDeleted?.();toast(`Deleted ${count} staff record${count===1?'':'s'}.`);}catch(error){toast(error.message,'error');remove.disabled=false;remove.textContent=count===1?'Delete staff member':`Delete ${count} staff members`;}}},count===1?'Delete staff member':`Delete ${count} staff members`);
  showDialog(el('div',{class:'dialog-body database-confirm'},el('h2',{},count===1?'Delete this staff member?':`Delete ${count} staff members?`),el('p',{},summary),el('div',{class:'danger-note'},el('strong',{},'This removes their Cornerstone Signatures record, access roles, and audience memberships.'),el('p',{},'If the account still matches the saved Entra filters, it will be added back by the next directory sync.')),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),remove)));
}

function confirmBlockStaff(user) {
  const block=el('button',{class:'button danger',type:'button',onclick:async()=>{try{block.disabled=true;block.textContent='Blocking…';const response=await api(`${API}/users/${encodeURIComponent(user.id)}/block`,{method:'POST'});dialog.close();toast(`${response.blocked.email} blocked from Entra sync.`);users();}catch(error){toast(error.message,'error');block.disabled=false;block.textContent='Block and remove';}}},'Block and remove');
  showDialog(el('div',{class:'dialog-body database-confirm'},el('h2',{},`Block ${userName(user)}?`),el('p',{},user.email),el('div',{class:'danger-note'},el('strong',{},'This removes their current Cornerstone Signatures record and prevents Entra from adding it back.'),el('p',{},`The exact address ${user.email} will be added to Manage → Excluded email patterns. Their Cornerstone Signatures roles and audience memberships will also be removed.`)),el('p',{class:'muted'},'To restore the account later, remove the address from the exclusion list and run an Entra sync.'),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),block)));
}

function directorySyncDialog() {
  const current=state.directorySync?.filters||{};
  const enabled=el('input',{type:'checkbox',checked:current.enabledOnly!==false});
  const members=el('input',{type:'checkbox',checked:current.membersOnly!==false});
  const domains=el('input',{value:(current.allowedDomains||[]).join(', '),placeholder:'example.com'});
  const excluded=el('textarea',{placeholder:'service-*@example.com\nadmin@example.com'},(current.excludedEmailPatterns||[]).join('\n'));
  const readList=value=>value.split(/[\n,]/).map(item=>item.trim()).filter(Boolean);
  const save=async run=>{try{const filters={enabledOnly:enabled.checked,membersOnly:members.checked,allowedDomains:readList(domains.value),excludedEmailPatterns:readList(excluded.value)};state.directorySync=await api(`${API}/directory-sync`,{method:'PUT',body:JSON.stringify({filters})});if(run){const response=await api(`${API}/directory-sync/run`,{method:'POST'});state.users=list(response);const result=response.result;dialog.close();toast(`Entra sync complete: ${result.created} added, ${result.updated} refreshed, ${result.filtered} filtered.`);users();}else{dialog.close();toast('Directory filters saved.');users();}}catch(error){toast(error.message,'error');}};
  showDialog(el('div',{class:'dialog-body'},el('h2',{},'Sync Microsoft Entra directory'),el('p',{},'Filters are stored in Cornerstone Signatures and applied before accounts enter the managed directory. Existing access choices and local profile overrides are never replaced by a sync.'),el('div',{class:'stack'},el('label',{class:'split-row'},el('span',{},el('strong',{},'Enabled accounts only'),el('small',{class:'muted'},'Skip disabled Entra accounts.')),enabled),el('label',{class:'split-row'},el('span',{},el('strong',{},'Member users only'),el('small',{class:'muted'},'Skip guest accounts.')),members),el('div',{class:'field'},el('label',{},'Allowed email domains'),domains,el('small',{},'Comma-separated. Leave empty to allow every domain.')),el('div',{class:'field'},el('label',{},'Excluded email patterns'),excluded,el('small',{},'One wildcard pattern per line; * and ? are supported.'))),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),el('button',{class:'button',type:'button',onclick:()=>save(false)},'Save filters'),el('button',{class:'button primary',type:'button',disabled:!state.directorySync?.configured,onclick:()=>save(true)},state.directorySync?.configured?'Save & sync now':'Credentials required'))));
}

function editUser(user) {
  const currentRoles=user.roles||[];
  const canDelete=user.deletable!==false&&user.email?.toLowerCase()!==state.session?.email?.toLowerCase();
  const blockAction=canDelete?el('button',{class:'button danger push-left',type:'button',onclick:()=>{dialog.close();setTimeout(()=>confirmBlockStaff(user),0);}},'Block'):'';
  const deleteAction=canDelete?el('button',{class:'button danger-outline',type:'button',onclick:()=>{dialog.close();setTimeout(()=>confirmDeleteStaff([user],users),0);}},'Delete staff member'):'';
  const visible=el('input',{type:'checkbox',checked:Boolean(user.visible)}); const applicable=el('input',{type:'checkbox',checked:Boolean(user.applicable)}); const canSelfOptOut=el('input',{type:'checkbox',checked:Boolean(user.can_self_opt_out)}); const canChooseTagline=el('input',{type:'checkbox',checked:Boolean(user.can_choose_tagline)}); const editor=el('input',{type:'checkbox',checked:currentRoles.includes('communications_editor')}); const administrator=el('input',{type:'checkbox',checked:currentRoles.includes('it_admin')});
  const titleOverride=el('input',{value:user.title_override||'',placeholder:user.directory_title||'No directory title'});
  const officeOverride=el('input',{value:user.office_location_override||'',placeholder:user.directory_office_location||'No directory location',list:'manage-office-location-options'});
  const phoneOverride=el('input',{value:user.phone_override||'',placeholder:user.directory_phone||'No directory phone'});
  const locationOptions=el('datalist',{id:'manage-office-location-options'});
  const identityMode=el('select',{},el('option',{value:'signed_in',selected:(user.signature_identity_mode||'signed_in')==='signed_in'},'Signed-in employee'),el('option',{value:'mailbox',selected:user.signature_identity_mode==='mailbox'},'This account / mailbox'));
  const form=el('div',{class:'dialog-body manage-user-dialog'},el('h2',{},'Manage staff access'),el('p',{},userName(user)),locationOptions,el('div',{class:'stack'},el('div',{class:'form-grid'},el('div',{class:'field'},el('label',{},'Signature job title override'),titleOverride,el('small',{},`Entra: ${user.directory_title||'not set'}. Leave blank to follow Entra.`)),el('div',{class:'field'},el('label',{},'Office location override'),officeOverride,el('small',{},`Entra: ${user.directory_office_location||'not set'}. Controls city order.`)),el('div',{class:'field'},el('label',{},'Business phone override'),phoneOverride,el('small',{},`Entra: ${user.directory_phone||'not set'}. Include the extension here.`))),el('label',{class:'split-row'},el('span',{},el('strong',{},'Visible in staff picker'),el('small',{class:'muted'},'Allow this directory user to appear in the staff-facing picker.')),visible),el('label',{class:'split-row'},el('span',{},el('strong',{},'Signature applicable'),el('small',{class:'muted'},'Include this person in signature delivery.')),applicable),el('label',{class:'split-row'},el('span',{},el('strong',{},'Signature identity'),el('small',{class:'muted'},'For shared sending, use the signed-in employee by default or intentionally use this mailbox’s configured details.')),identityMode),el('label',{class:'split-row'},el('span',{},el('strong',{},'Allow self-service opt-out'),el('small',{class:'muted'},user.self_opted_out?'This user is currently opted out. Revoking permission resumes delivery.':'Let this user pause or resume their own signature delivery.')),canSelfOptOut),el('label',{class:'split-row'},el('span',{},el('strong',{},'Allow tagline choice'),el('small',{class:'muted'},'Let this user choose from the approved Cornerstone taglines.')),canChooseTagline),el('label',{class:'split-row'},el('span',{},el('strong',{},'Communications editor'),el('small',{class:'muted'},'Can edit, preview, and publish templates.')),editor),el('label',{class:'split-row'},el('span',{},el('strong',{},'IT administrator'),el('small',{class:'muted'},'Can manage users, role grants, and the audit log.')),administrator)),el('div',{class:'dialog-actions'},blockAction,deleteAction,el('button',{class:'button',value:'cancel'},'Cancel'),el('button',{class:'button primary',value:'default',type:'button',onclick:async()=>{try{const id=encodeURIComponent(user.id);const nextRoles=[];if(editor.checked)nextRoles.push('communications_editor');if(administrator.checked)nextRoles.push('it_admin');await api(`${API}/users/${id}`,{method:'PATCH',body:JSON.stringify({visible:visible.checked,applicable:applicable.checked,signatureIdentityMode:identityMode.value,canSelfOptOut:canSelfOptOut.checked,canChooseTagline:canChooseTagline.checked,titleOverride:titleOverride.value.trim()||null,officeLocationOverride:officeOverride.value.trim()||null,phoneOverride:phoneOverride.value.trim()||null})});await api(`${API}/users/${id}/roles`,{method:'PUT',body:JSON.stringify({roles:nextRoles})});dialog.close();toast('Staff access and signature details updated.');users();}catch(e){toast(e.message,'error');}}},'Save changes')));
  showDialog(form);
}

async function taglines() {
  state.taglines=list(await api(`${API}/taglines`));
  const body=el('tbody');
  for(const item of state.taglines){
    body.append(el('tr',{},
      el('td',{},el('strong',{},item.label),el('small',{class:'muted block'},item.key)),
      el('td',{},item.is_default?badge('Default','success'):'—'),
      el('td',{},date(item.updated_at)),
      el('td',{},el('div',{class:'actions'},
        el('button',{class:'button small',type:'button',onclick:()=>taglineEditor(item)},'Edit'),
        item.is_default?'':el('button',{class:'button small danger-outline',type:'button',onclick:()=>deleteTaglineDialog(item)},'Delete')))));
  }
  if(!state.taglines.length)body.append(emptyRow(4,'No approved taglines yet.'));
  const table=el('div',{class:'card table-wrap'},el('table',{class:'table tagline-table'},el('thead',{},el('tr',{},el('th',{},'Tagline'),el('th',{},'Status'),el('th',{},'Updated'),el('th',{},'Actions'))),body));
  main.replaceChildren(pageHead('Taglines editor','Manage the approved phrases available in templates and staff self-service.',el('button',{class:'button primary',type:'button',onclick:()=>taglineEditor(null)},'New tagline')),onboardingTip('tagline-workspace','Communications workspace','Changes apply immediately anywhere a published template uses {{tagline}}. The default is used when a staff selection is missing.'),table);
}

function taglineEditor(item) {
  const label=el('textarea',{maxlength:240,placeholder:'Enter the approved tagline'},item?.label||'');
  const makeDefault=el('input',{type:'checkbox',checked:Boolean(item?.is_default)});
  const save=el('button',{class:'button primary',type:'button',onclick:async()=>{
    const value=label.value.trim();if(!value){toast('Enter a tagline.','error');label.focus();return;}
    try{save.disabled=true;await api(item?`${API}/taglines/${encodeURIComponent(item.id)}`:`${API}/taglines`,{method:item?'PUT':'POST',body:JSON.stringify({label:value,isDefault:makeDefault.checked})});dialog.close();toast(item?'Tagline updated.':'Tagline created.');taglines();}catch(error){toast(error.message,'error');save.disabled=false;}
  }},item?'Save changes':'Create tagline');
  showDialog(el('div',{class:'dialog-body tagline-dialog'},el('h2',{},item?'Edit tagline':'New tagline'),el('p',{},'This text will be inserted into every signature assigned to it.'),el('div',{class:'field'},el('label',{},'Tagline'),label,el('small',{},'Plain text only. Signature templates control its visual formatting.')),el('label',{class:'split-row'},el('span',{},el('strong',{},'Use as default'),el('small',{class:'muted block'},item?.is_default?'Choose another tagline as default before clearing this setting.':'Staff without a valid selection will use this tagline.')),makeDefault),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),save)));
}

function deleteTaglineDialog(item) {
  const remove=el('button',{class:'button danger',type:'button',onclick:async()=>{try{remove.disabled=true;const result=await api(`${API}/taglines/${encodeURIComponent(item.id)}`,{method:'DELETE'});dialog.close();toast(result.reassigned?`Tagline deleted; ${result.reassigned} staff selection${result.reassigned===1?' was':'s were'} reset to default.`:'Tagline deleted.');taglines();}catch(error){toast(error.message,'error');remove.disabled=false;}}},'Delete tagline');
  showDialog(el('div',{class:'dialog-body database-confirm'},el('h2',{},'Delete this tagline?'),el('p',{},item.label),el('div',{class:'danger-note'},el('strong',{},'Staff using it will be reset to the default tagline.'),el('p',{},'Published templates are not changed.')),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),remove)));
}

async function mergeTags() {
  state.mergeTags=await api(`${API}/merge-tags`);
  const body=el('tbody');
  for(const tag of state.mergeTags.builtIns||[])body.append(el('tr',{},el('td',{class:'code'},`{{${tag.key}}}`),el('td',{},tag.description),el('td',{},badge(tag.category,'info')),el('td',{},badge('Built in','success')),el('td',{})));
  for(const tag of state.mergeTags.customTags||[])body.append(el('tr',{},el('td',{class:'code'},`{{${tag.key}}}`),el('td',{},tag.description||el('span',{class:'muted'},'No description')),el('td',{},el('span',{class:'tag-value-preview'},tag.value||el('span',{class:'muted'},'Empty'))),el('td',{},badge('Custom','warning')),el('td',{},el('div',{class:'actions'},el('button',{class:'button small',type:'button',onclick:()=>mergeTagEditor(tag)},'Edit'),el('button',{class:'button small danger',type:'button',onclick:()=>deleteMergeTagDialog(tag)},'Delete')))));
  if(!(state.mergeTags.builtIns?.length||state.mergeTags.customTags?.length))body.append(emptyRow(5,'No merge tags are available.'));
  const table=el('div',{class:'card table-wrap'},el('table',{class:'table merge-tag-table'},el('thead',{},el('tr',{},...['Merge tag','Description','Value / category','Type','Actions'].map(label=>el('th',{},label)))),body));
  main.replaceChildren(pageHead('Tags','Browse built-in template fields and manage reusable custom values.',el('button',{class:'button primary',type:'button',onclick:()=>mergeTagEditor(null)},'New custom tag')),onboardingTip('merge-tag-workspace','Reusable template values','Custom tag changes apply immediately anywhere a published signature uses that merge tag. Values are inserted as safe plain text.'),table);
}

function mergeTagEditor(tag) {
  const key=el('input',{value:tag?.key||'',maxlength:64,placeholder:'campaignUrl',spellcheck:'false'});
  const description=el('input',{value:tag?.description||'',maxlength:240,placeholder:'Current campaign landing page'});
  const value=el('textarea',{maxlength:10000,placeholder:'https://example.org/current-campaign'},tag?.value||'');
  const save=el('button',{class:'button primary',type:'button',onclick:async()=>{try{save.disabled=true;const payload={key:key.value.trim(),description:description.value.trim(),value:value.value};await api(tag?`${API}/merge-tags/${encodeURIComponent(tag.key)}`:`${API}/merge-tags`,{method:tag?'PUT':'POST',body:JSON.stringify(payload)});dialog.close();toast(tag?'Custom tag updated.':'Custom tag created.');mergeTags();}catch(error){toast(error.message,'error');save.disabled=false;}}},tag?'Save changes':'Create tag');
  showDialog(el('div',{class:'dialog-body merge-tag-dialog'},el('h2',{},tag?'Edit custom tag':'New custom tag'),el('p',{},'Use the generated merge tag in HTML or MJML templates. Values are escaped when a signature is rendered.'),el('div',{class:'field'},el('label',{},'Tag key'),key,el('small',{},'Starts with a letter; letters, numbers, and underscores only.')),el('div',{class:'field'},el('label',{},'Description'),description),el('div',{class:'field'},el('label',{},'Plain-text value'),value),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),save)));
}

function deleteMergeTagDialog(tag) {
  const remove=el('button',{class:'button danger',type:'button',onclick:async()=>{try{remove.disabled=true;await api(`${API}/merge-tags/${encodeURIComponent(tag.key)}`,{method:'DELETE'});dialog.close();toast('Custom tag deleted.');mergeTags();}catch(error){toast(error.message,'error');remove.disabled=false;}}},'Delete tag');
  showDialog(el('div',{class:'dialog-body database-confirm'},el('h2',{},'Delete this custom tag?'),el('p',{class:'code'},`{{${tag.key}}}`),el('div',{class:'danger-note'},el('strong',{},'Templates using it will show the unresolved merge tag.'),el('p',{},'Update or stop using the tag before deleting it if it is present in a published signature.')),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),remove)));
}

async function templates() {
  const [templatePayload,deploymentPayload,taglinePayload,mergeTagPayload]=await Promise.all([api(`${API}/templates`),api(`${API}/deployments`),api(`${API}/taglines`),api(`${API}/merge-tags`)]);
  state.templates=list(templatePayload); state.deployments=list(deploymentPayload);state.scheduledDeployments=deploymentPayload?.scheduled||[]; state.taglines=list(taglinePayload);state.mergeTags=mergeTagPayload;
  const cards=el('div',{class:'template-list'});
  state.templates.forEach(t=>{const active=state.deployments.filter(d=>d.template_id===t.id&&d.template_revision===t.revision&&d.status==='published');const pending=state.scheduledDeployments.filter(d=>d.template_id===t.id&&d.template_revision===t.revision&&d.status==='scheduled'); const frame=el('iframe',{title:`Preview of ${t.name||'signature template'}`,sandbox:'','aria-hidden':'true'}); frame.srcdoc=t.html||'<p style="font:12px sans-serif;color:#667085">No preview available</p>'; const duplicate=el('button',{class:'button small',type:'button',onclick:async()=>{try{duplicate.disabled=true;await api(`${API}/templates/${encodeURIComponent(t.id)}/duplicate`,{method:'POST'});toast('Template duplicated as a new draft.');templates();}catch(error){toast(error.message,'error');duplicate.disabled=false;}}},'Duplicate');const actions=el('div',{class:'actions template-actions'},t.deletable?el('button',{class:'button small danger',type:'button',onclick:()=>deleteTemplateDialog(t)},'Delete'):'',duplicate,el('button',{class:'button small',type:'button',onclick:()=>publishTemplateDialog(t,true)},'Schedule'),el('button',{class:'button small',type:'button',onclick:()=>publishTemplateDialog(t)},'Publish'),el('button',{class:'button small',type:'button',onclick:()=>templateEditor(t)},t.source_mjml?'Design':'Edit'));const status=active.length?badge(`Published · ${active.length} active`,'success'):pending.length?badge(`Scheduled · ${pending.length}`,'info'):badge('Draft','warning');cards.append(el('article',{class:'card template-card'},el('div',{class:'template-preview'},frame),el('div',{class:'template-meta'},el('h3',{},t.name||'Untitled template'),el('p',{},`Revision ${t.revision||1} · ${t.source_mjml?'Visual MJML':'Legacy HTML'} · Updated ${date(t.updated_at||t.updatedAt)}`),el('div',{class:'template-footer'},status,actions))));});
  if(!state.templates.length) cards.append(el('div',{class:'card state'},el('div',{},el('div',{class:'state-icon'},'✎'),el('h2',{},'No templates yet'),el('p',{},'Create the first managed signature template.'))));
  const createMenu=el('details',{class:'create-menu'},el('summary',{class:'button primary'},'New template'),el('div',{class:'create-popover'},el('button',{type:'button',onclick:()=>{createMenu.open=false;templateEditor({},'visual');}},el('strong',{},'Visual template'),el('small',{},'Drag-and-drop MJML designer')),el('button',{type:'button',onclick:()=>{createMenu.open=false;templateEditor({},'html');}},el('strong',{},'Legacy HTML'),el('small',{},'Write email-safe HTML directly'))));
  main.replaceChildren(pageHead('Signature templates','Design, preview, version, and publish approved signatures.',createMenu),onboardingTip('template-workspace','Communications workspace','Publish to all applicable staff or a selected audience. The highest-priority matching signature wins.'),cards);
}

function deleteTemplateDialog(template) {
  const remove=el('button',{class:'button danger',type:'button',disabled:template.actively_deployed||template.pending_schedule,onclick:async()=>{try{remove.disabled=true;await api(`${API}/templates/${encodeURIComponent(template.id)}`,{method:'DELETE'});dialog.close();toast('Template deleted.');templates();}catch(error){toast(error.message,'error');remove.disabled=template.actively_deployed||template.pending_schedule;}}},'Delete template');
  const warning=template.actively_deployed?el('div',{class:'danger-note'},el('strong',{},'This template is actively deployed.'),el('p',{},'Unpublish or replace each active deployment before deleting this template.')):template.pending_schedule?el('div',{class:'danger-note'},el('strong',{},'This template has a pending deployment.'),el('p',{},'Cancel it from Deployments before deleting this template.')):'';
  showDialog(el('div',{class:'dialog-body database-confirm'},el('h2',{},`Delete ${template.name}?`),el('p',{},'The template will disappear from the workspace, while immutable deployment history and audit records remain intact.'),warning,el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),remove)));
}

const DEFAULT_MJML = `<mjml>
  <mj-head>
    <mj-attributes>
      <mj-all font-family="Segoe UI, Arial, sans-serif" color="#0B224E"></mj-all>
      <mj-text padding="0" font-size="16px" line-height="1.25" />
    </mj-attributes>
  </mj-head>
  <mj-body width="620px" background-color="#ffffff">
    <mj-section padding="0" background-color="#ffffff">
      <mj-column padding="0">
        <mj-text font-size="19px" font-weight="700">{{displayName}}</mj-text>
        <mj-text font-size="15px" font-style="italic" padding-top="2px">{{title}}</mj-text>
        <mj-spacer height="16px"></mj-spacer>
        <mj-text font-weight="600">{{organizationName}}</mj-text>
        <mj-text>{{locations}}</mj-text>
        <mj-text font-size="15px">{{phone}}</mj-text>
        <mj-spacer height="16px"></mj-spacer>
        <mj-text><a href="{{websiteUrl}}" style="color:#0B224E">{{websiteUrl}}</a></mj-text>
        <mj-spacer height="14px"></mj-spacer>
        <mj-text font-size="13px">{{tagline}}</mj-text>
      </mj-column>
    </mj-section>
  </mj-body>
</mjml>`;

const legacyMjml = html => `<mjml><mj-body width="620px" background-color="#ffffff"><mj-section padding="0" background-color="#ffffff"><mj-column padding="0"><mj-raw>\n${html}\n</mj-raw></mj-column></mj-section></mj-body></mjml>`;

const DEFAULT_HTML = `<table cellpadding="0" cellspacing="0" border="0" style="font-family:'Segoe UI',Arial,sans-serif;color:#0B224E;font-size:12pt;line-height:1.2;border-collapse:collapse">
  <tr><td>
    <strong style="font-size:14pt">{{displayName}}</strong><br>
    <em style="font-size:11pt">{{title}}</em><br><br>
    <span style="font-weight:600">{{organizationName}}</span><br>
    {{locations}}<br>
    <span style="font-size:11pt">{{phone}}</span><br><br>
    <span style="font-size:10pt">{{tagline}}</span>
  </td></tr>
</table>`;

async function saveTemplate(template,name,payload,publish) {
  if(!name.trim()){toast('Enter a template name.','error');return;}
  try {
    const result=await api(template.id?`${API}/templates/${encodeURIComponent(template.id)}`:`${API}/templates`,{method:template.id?'PUT':'POST',body:JSON.stringify({name:name.trim(),...payload})});
    const saved=result?.template||result;const id=saved?.id||template.id;
    if(!id)throw new Error('Template saved but no ID was returned.');
    dialog.close();
    if(publish){toast('Draft saved. Now choose its audience and priority.');requestAnimationFrame(()=>publishTemplateDialog({...template,...saved,id}));}
    else{toast('Draft saved.');templates();}
  } catch(error) { toast(error.message,'error'); }
}

async function publishTemplateDialog(template=null,scheduled=false) {
  try {
    const requests=[api(`${API}/audiences`),api(`${API}/deployments`)];if(!template)requests.push(api(`${API}/templates`));
    const [audiencePayload,deploymentPayload,templatePayload]=await Promise.all(requests);
    state.audiences=list(audiencePayload);state.deployments=list(deploymentPayload);state.scheduledDeployments=deploymentPayload?.scheduled||[];if(templatePayload)state.templates=list(templatePayload);
    if(!template&&!state.templates.length){toast('Create a signature template before scheduling a deployment.','error');return;}
    const active=state.deployments.filter(item=>item.status==='published');
    const defaultDeployment=active.find(item=>item.audience_id==null);
    const templateSelect=template?null:el('select',{'aria-label':'Signature template'},...state.templates.map(item=>el('option',{value:item.id},`${item.name} · revision ${item.revision}`)));
    const audience=el('select',{'aria-label':'Deployment audience'},el('option',{value:''},'All applicable staff (default)'),...state.audiences.map(item=>el('option',{value:item.id},`${item.name} · ${item.member_count} member${item.member_count===1?'':'s'}`)));
    const priority=el('input',{type:'number',min:0,max:1000,step:1,value:0,'aria-label':'Signature priority'});
    const when=scheduled?el('input',{type:'datetime-local','aria-label':'Deployment date and time'}):null;
    if(when){const defaultTime=new Date(Date.now()+60*60*1000);defaultTime.setMinutes(Math.ceil(defaultTime.getMinutes()/5)*5,0,0);const offset=defaultTime.getTimezoneOffset()*60000;when.value=new Date(defaultTime-offset).toISOString().slice(0,16);when.min=new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16);}
    let priorityEdited=false;priority.addEventListener('input',()=>{priorityEdited=true;});
    const summary=el('div',{class:'priority-summary'});
    const update=()=>{const minimum=defaultDeployment?Number(defaultDeployment.priority)+1:1;const selectedId=audience.value?Number(audience.value):null;const existing=active.find(item=>(item.audience_id??null)===selectedId);if(!priorityEdited)priority.value=existing?.priority??(audience.value?Math.max(100,minimum):0);const label=audience.selectedOptions[0]?.textContent||'All applicable staff';summary.replaceChildren(el('strong',{},`${label} · priority ${priority.value}`),el('p',{},audience.value?`This must remain above the active default priority${defaultDeployment?` (${defaultDeployment.priority})`:''}. Higher matching priorities override this one.`:'The default must remain below every active limited-audience signature.'));};
    audience.addEventListener('change',update);update();
    const publish=el('button',{class:'button primary',type:'button',onclick:async()=>{const numericPriority=Number(priority.value);if(!Number.isInteger(numericPriority)||numericPriority<0||numericPriority>1000){toast('Priority must be a whole number from 0 to 1000.','error');priority.focus();return;}const selectedTemplate=template||state.templates.find(item=>item.id===Number(templateSelect.value));if(!selectedTemplate){toast('Choose a signature template.','error');return;}let scheduledFor;if(scheduled){const scheduledTime=Date.parse(when.value);if(!when.value||!Number.isFinite(scheduledTime)||scheduledTime<=Date.now()){toast('Choose a future deployment date and time.','error');when.focus();return;}scheduledFor=new Date(scheduledTime).toISOString();}try{publish.disabled=true;await api(`${API}/templates/${encodeURIComponent(selectedTemplate.id)}/${scheduled?'schedule':'publish'}`,{method:'POST',body:JSON.stringify({audienceId:audience.value?Number(audience.value):null,priority:numericPriority,...(scheduled?{scheduledFor}:{})})});dialog.close();toast(scheduled?'Deployment scheduled.':'Template published.');state.route==='deployments'?deployments():templates();}catch(error){toast(error.message,'error');publish.disabled=false;}}},scheduled?'Schedule deployment':'Publish signature');
    const fields=[];if(templateSelect)fields.push(el('div',{class:'field full'},el('label',{},'Template'),templateSelect,el('small',{},'The current revision is snapshotted and will not change before deployment.')));fields.push(el('div',{class:'field'},el('label',{},'Audience'),audience,el('small',{},'Limited audience membership is managed by IT.')),el('div',{class:'field'},el('label',{},'Priority'),priority,el('small',{},'A configurable whole number from 0 to 1000.')));if(when)fields.push(el('div',{class:'field full'},el('label',{},'Deploy at'),when,el('small',{},`Uses your local time (${Intl.DateTimeFormat().resolvedOptions().timeZone||'browser time zone'}). The server normally activates it within 30 seconds.`)));
    showDialog(el('div',{class:'dialog-body publish-dialog'},el('h2',{},scheduled?'Schedule deployment':'Publish signature'),el('p',{},template?`${template.name} · Revision ${template.revision}`:'Choose a saved signature and its delivery rules.'),el('div',{class:'form-grid'},...fields),summary,el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),publish)));
  } catch(error) { toast(error.message,'error');templates(); }
}

function templateEditor(template={},format='visual') {
  if(format==='html'||(template.id&&!template.source_mjml))return legacyTemplateEditor(template);
  visualTemplateEditor(template,template.source_mjml||DEFAULT_MJML);
}

function legacyTemplateEditor(template) {
  const name=el('input',{value:template.name||'',required:true});const html=el('textarea',{},template.html||DEFAULT_HTML);
  const frame=el('iframe',{title:'Signature preview',sandbox:''});
  const update=()=>{frame.srcdoc=sampleTemplate(html.value);};html.addEventListener('input',update);update();
  const convert=()=>{dialog.close();requestAnimationFrame(()=>visualTemplateEditor(template,legacyMjml(html.value),true));};
  showDialog(el('div',{class:'dialog-body template-editor-dialog'},el('h2',{},template.id?'Edit legacy HTML template':'New legacy HTML template'),el('div',{class:'legacy-editor-note'},el('div',{},el('strong',{},template.id?'This template uses direct HTML.':'Direct HTML editor'),el('p',{},template.id?'Keep editing its email-safe HTML, or convert it to MJML. Conversion preserves the current signature inside a raw compatibility block.':'Write email-safe HTML directly. You can convert it to the visual MJML designer later if you choose.')),el('button',{class:'button primary',type:'button',onclick:convert},'Convert to visual designer')),el('div',{class:'editor-grid'},el('div',{class:'stack'},el('div',{class:'field'},el('label',{},'Template name'),name),el('div',{class:'field'},el('label',{},'Signature HTML'),html)),el('div',{class:'card'},el('div',{class:'section-head'},el('h3',{},'Preview'),badge('Legacy HTML','warning')),el('div',{class:'preview-shell'},frame))),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),el('button',{class:'button',type:'button',onclick:()=>saveTemplate(template,name.value,{html:html.value},false)},'Save draft'),el('button',{class:'button primary',type:'button',onclick:()=>saveTemplate(template,name.value,{html:html.value},true)},'Save & choose audience'))));
}

function sampleTemplate(source) {
  const tagline=state.taglines.find(item=>item.is_default)?.label||state.taglines[0]?.label||'';
  const customValues=Object.fromEntries((state.mergeTags.customTags||[]).map(tag=>[tag.key,tag.value]));
  const values={firstName:'Taylor',lastName:'Morgan',displayName:'Taylor Morgan',title:'Communications Manager',email:'taylor.morgan@example.com',phone:'+1 555 010 1234',officeLocation:'Main office',locations:'Main office',tagline,designations:'REALTOR®, CIPS',organizationName:'Your organization',...(state.session?.branding||{}),...customValues};
  return String(source).replace(/{{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*}}/g,(token,key)=>Object.hasOwn(values,key)?escapeHtml(values[key]):token);
}

function visualTemplateEditor(template,initialMjml,converted=false) {
  if(!window.grapesjs||!window['grapesjs-mjml']){toast('The visual editor could not be loaded. Refresh and try again.','error');return;}
  const name=el('input',{value:template.name||'',required:true});const host=el('div',{class:'visual-editor-host'});const source=el('textarea',{class:'mjml-source','aria-label':'MJML source'},initialMjml);
  const visualButton=el('button',{class:'button small active',type:'button'},'Visual');const sourceButton=el('button',{class:'button small',type:'button'},'MJML source');
  const modeControls=el('div',{class:'editor-mode-controls'},visualButton,sourceButton);
  const content=el('div',{class:'dialog-body visual-template-dialog'},el('div',{class:'visual-editor-heading'},el('div',{},el('h2',{},template.id?'Design signature template':'New signature template'),el('p',{},'Drag blocks into the canvas, edit content in place, and use the Cornerstone Signatures fields for managed staff data.')),el('div',{class:'field visual-name'},el('label',{},'Template name'),name)),converted?el('div',{class:'legacy-conversion-note'},'The existing HTML is preserved in a compatibility block. You can keep it, remove it, or rebuild it with visual components.'):'' ,el('div',{class:'visual-editor-toolbar'},modeControls,el('span',{class:'muted'},'Server-compiled MJML · email-safe HTML')),host,source,el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),el('button',{class:'button',type:'button'},'Save draft'),el('button',{class:'button primary',type:'button'},'Save & choose audience')));
  const actions=content.querySelectorAll('.dialog-actions button');showDialog(content);
  requestAnimationFrame(()=>{
    const editor=window.grapesjs.init({container:host,height:'clamp(430px, calc(96vh - 235px), 610px)',storageManager:false,fromElement:false,components:initialMjml,plugins:['grapesjs-mjml']});
    const fields=[['displayName','Staff name'],['title','Job title'],['designations','Professional designations'],['phone','Business phone'],['email','Email address'],['locations','Ordered locations'],['officeLocation','Office location'],['tagline','Approved tagline'],['organizationName','Organization name'],['websiteUrl','Website URL'],['facebookUrl','Facebook URL'],['instagramUrl','Instagram URL'],['linkedinUrl','LinkedIn URL'],['xUrl','X URL'],['threadsUrl','Threads URL'],['blueskyUrl','Bluesky URL'],['youtubeUrl','YouTube URL']];
    for(const tag of state.mergeTags.customTags||[])fields.push([tag.key,tag.description||tag.key]);
    fields.forEach(([token,label])=>editor.BlockManager.add(`cornerstone-signatures-${token}`,{label,category:'Cornerstone Signatures fields',content:`<mj-text padding="0">{{${token}}}</mj-text>`,attributes:{title:`Insert {{${token}}}`}}));
    editor.runCommand('open-blocks');
    const setMode=showSource=>{if(showSource){source.value=editor.runCommand('mjml-code');host.hidden=true;source.hidden=false;}else{editor.setComponents(source.value.trim());source.hidden=true;host.hidden=false;editor.refresh();}visualButton.classList.toggle('active',!showSource);sourceButton.classList.toggle('active',showSource);};
    visualButton.onclick=()=>setMode(false);sourceButton.onclick=()=>setMode(true);source.hidden=true;
    const currentMjml=()=>source.hidden?editor.runCommand('mjml-code'):source.value.trim();
    actions[1].onclick=()=>saveTemplate(template,name.value,{mjml:currentMjml()},false);
    actions[2].onclick=()=>saveTemplate(template,name.value,{mjml:currentMjml()},true);
    dialog.addEventListener('close',()=>editor.destroy(),{once:true});
  });
}

async function deployments() {
  const payload=await api(`${API}/deployments`);state.deployments=list(payload);state.scheduledDeployments=payload?.scheduled||[];
  const body=el('tbody'); state.deployments.forEach(d=>{const active=d.status==='published'&&can('communications_editor');body.append(el('tr',{},el('td',{},el('strong',{},`${d.template_name||`Template ${d.template_id}`} · revision ${d.template_revision}`),el('div',{class:'muted'},`Deployment ${d.id}`)),el('td',{},el('strong',{},d.audience_name||'All applicable staff'),el('small',{class:'muted block'},`${d.audience_size} current member${d.audience_size===1?'':'s'}`)),el('td',{},badge(`Priority ${d.priority??0}`,'info')),el('td',{},badge(d.status||'Pending',d.status==='published'?'success':'')),el('td',{},date(d.published_at||d.createdAt)),el('td',{},d.published_by||d.createdBy||'—'),el('td',{},active?el('div',{class:'actions'},el('button',{class:'button small',type:'button',onclick:()=>editDeploymentPriority(d)},'Set priority'),el('button',{class:'button small danger',type:'button',onclick:()=>unpublishDeploymentDialog(d)},'Unpublish')):'')));});
  if(!state.deployments.length)body.append(emptyRow(7,'No signatures have been published yet.'));
  const scheduleBody=el('tbody');state.scheduledDeployments.forEach(item=>{const pending=item.status==='scheduled'&&can('communications_editor');scheduleBody.append(el('tr',{},el('td',{},el('strong',{},`${item.template_name||`Template ${item.template_id}`} · revision ${item.template_revision}`),el('small',{class:'muted block'},`Schedule ${item.id}`)),el('td',{},item.audience_name||'All applicable staff'),el('td',{},badge(`Priority ${item.priority??0}`,'info')),el('td',{},badge(humanize(item.status),item.status==='scheduled'?'info':item.status==='published'?'success':item.status==='failed'?'danger':''),item.error_message?el('small',{class:'schedule-error'},item.error_message):''),el('td',{},date(item.scheduled_for)),el('td',{},item.scheduled_by||'—'),el('td',{},pending?el('button',{class:'button small danger-outline',type:'button',onclick:()=>cancelScheduledDeploymentDialog(item)},'Cancel'):'')));});if(!state.scheduledDeployments.length)scheduleBody.append(emptyRow(7,'No deployments have been scheduled.'));
  const scheduleAction=can('communications_editor')?el('button',{class:'button primary',type:'button',onclick:()=>publishTemplateDialog(null,true)},'Schedule deployment'):'';
  main.replaceChildren(pageHead('Deployments','Monitor priority-ordered signature versions delivered to applicable Outlook users.',scheduleAction),onboardingTip('deployment-priority','Highest matching priority wins','The all-staff default normally uses priority 0. Limited-audience signatures must use a higher configurable integer.'),el('section',{class:'card scheduled-card'},el('div',{class:'section-head'},el('div',{},el('h3',{},'Scheduled deployments'),el('p',{},'A saved template revision will publish automatically at its scheduled local date and time.'))),el('div',{class:'table-wrap'},el('table',{class:'table deployment-table'},el('thead',{},el('tr',{},...['Deployment','Audience','Priority','Status','Scheduled for','Scheduled by',''].map(x=>el('th',{},x)))),scheduleBody))),el('section',{class:'card'},el('div',{class:'section-head'},el('div',{},el('h3',{},'Deployment history'),el('p',{},'Publishing replaces the active signature for the same audience and retains older snapshots as superseded history.'))),el('div',{class:'table-wrap'},el('table',{class:'table deployment-table'},el('thead',{},el('tr',{},...['Deployment','Audience','Priority','Status','Published','Published by',''].map(x=>el('th',{},x)))),body))));
}

function cancelScheduledDeploymentDialog(item) {
  const cancel=el('button',{class:'button danger',type:'button',onclick:async()=>{try{cancel.disabled=true;await api(`${API}/scheduled-deployments/${encodeURIComponent(item.id)}/cancel`,{method:'POST',body:'{}'});dialog.close();toast('Scheduled deployment cancelled.');deployments();}catch(error){toast(error.message,'error');cancel.disabled=false;}}},'Cancel deployment');
  showDialog(el('div',{class:'dialog-body database-confirm'},el('h2',{},'Cancel scheduled deployment?'),el('p',{},`${item.template_name} · revision ${item.template_revision}`),el('div',{class:'danger-note'},el('strong',{},`It will not publish on ${date(item.scheduled_for)}.`),el('p',{},'The cancelled schedule remains in history for auditing.')),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Keep scheduled'),cancel)));
}

function unpublishDeploymentDialog(deployment) {
  const isDefault=deployment.audience_id==null;
  const confirmation=isDefault?el('input',{placeholder:'Type UNPUBLISH','aria-label':'Type UNPUBLISH to confirm',autocomplete:'off'}):null;
  const remove=el('button',{class:'button danger',type:'button',disabled:isDefault,onclick:async()=>{try{remove.disabled=true;await api(`${API}/deployments/${encodeURIComponent(deployment.id)}/unpublish`,{method:'POST',body:JSON.stringify(isDefault?{confirmation:confirmation.value}:{})});dialog.close();toast(isDefault?'All-staff signature unpublished.':'Audience signature unpublished; members will use their next matching deployment.');deployments();}catch(error){toast(error.message,'error');remove.disabled=isDefault&&confirmation.value!=='UNPUBLISH';}}},'Unpublish');
  if(confirmation)confirmation.oninput=()=>{remove.disabled=confirmation.value!=='UNPUBLISH';};
  const audience=deployment.audience_name||'All applicable staff';
  const consequence=isDefault?'Staff who do not match another active audience will no longer receive a managed signature.':`${deployment.audience_size} current member${deployment.audience_size===1?'':'s'} will use the next-highest matching deployment, normally the all-staff default.`;
  showDialog(el('div',{class:'dialog-body database-confirm'},el('h2',{},`Unpublish from ${audience}?`),el('p',{},`${deployment.template_name} · revision ${deployment.template_revision}`),el('div',{class:'danger-note'},el('strong',{},consequence),el('p',{},'The deployment remains in immutable history and can be replaced by publishing this or another template again.')),confirmation?el('div',{class:'field'},el('label',{},'Type UNPUBLISH to confirm'),confirmation):'',el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),remove)));
}

function editDeploymentPriority(deployment) {
  const priority=el('input',{type:'number',min:0,max:1000,step:1,value:deployment.priority??0});
  const save=el('button',{class:'button primary',type:'button',onclick:async()=>{const value=Number(priority.value);if(!Number.isInteger(value)||value<0||value>1000){toast('Priority must be a whole number from 0 to 1000.','error');return;}try{save.disabled=true;await api(`${API}/deployments/${encodeURIComponent(deployment.id)}`,{method:'PATCH',body:JSON.stringify({priority:value})});dialog.close();toast('Deployment priority updated.');deployments();}catch(error){toast(error.message,'error');save.disabled=false;}}},'Save priority');
  showDialog(el('div',{class:'dialog-body database-confirm'},el('h2',{},'Set deployment priority'),el('p',{},`${deployment.template_name} · ${deployment.audience_name||'All applicable staff'}`),el('div',{class:'field'},el('label',{},'Priority'),priority,el('small',{},deployment.audience_id==null?'Must remain lower than every active limited-audience signature.':'Must remain higher than the active all-staff default.')),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),save)));
}

async function audit(){
  state.audit=list(await api(`${API}/audit`));
  const detailsFor=event=>{const raw=event.details_json??event.details;if(!raw)return {};if(typeof raw==='object')return raw;try{return JSON.parse(raw);}catch{return {details:raw};}};
  const displayValue=value=>Array.isArray(value)?(value.length>4?`${value.length} records`:value.join(', ')):typeof value==='boolean'?(value?'Yes':'No'):value==null?'—':typeof value==='object'?JSON.stringify(value):String(value);
  const eventLabel=event=>String(event.action||event.type||'change').split('.').map(humanize).join(' · ');
  const body=el('tbody');
  state.audit.forEach(event=>{
    const details=detailsFor(event);const detailItems=Object.entries(details).map(([key,value])=>el('span',{class:'audit-field'},el('b',{},humanize(key)),el('span',{},displayValue(value))));
    const entity=[humanize(event.entity_type||''),event.entity_id?`#${event.entity_id}`:''].filter(Boolean).join(' ');
    body.append(el('tr',{},
      el('td',{class:'audit-when'},el('strong',{},date(event.created_at||event.createdAt||event.timestamp))),
      el('td',{class:'audit-event'},badge(eventLabel(event),'info'),entity?el('small',{},entity):''),
      el('td',{class:'audit-actor'},event.actor_email||event.actorName||event.actor||'System'),
      el('td',{class:'audit-detail'},event.description?el('p',{},event.description):'',detailItems.length?el('div',{class:'audit-fields'},...detailItems):el('span',{class:'muted'},'No additional details')),
      el('td',{class:'code audit-reference'},event.requestId||`#${event.id||'—'}`)
    ));
  });
  if(!state.audit.length)body.append(emptyRow(5,'No audit events have been recorded.'));
  const exportCsv=()=>{const quote=value=>`"${String(value??'').replaceAll('"','""')}"`;const rows=state.audit.map(event=>[event.created_at||event.createdAt||event.timestamp||'',event.actor_email||event.actorName||event.actor||'System',event.action||event.type||'Change',event.entity_type||'',event.entity_id||'',JSON.stringify(detailsFor(event)),event.requestId||event.id||'']);const csv=['When,Actor,Action,Entity type,Entity ID,Details,Reference',...rows.map(row=>row.map(quote).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob([`\ufeff${csv}`],{type:'text/csv;charset=utf-8'}));const link=el('a',{href:url,download:`cornerstone-signatures-audit-${new Date().toISOString().slice(0,10)}.csv`});document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);toast(`Exported ${state.audit.length} audit event${state.audit.length===1?'':'s'}.`);};
  const exportButton=el('button',{class:'button primary',type:'button',disabled:!state.audit.length,onclick:exportCsv},'Export CSV');
  main.replaceChildren(pageHead('Audit log','Review traceable changes to access, templates, assignments, and deployments.',exportButton),el('section',{class:'card audit-card'},el('div',{class:'section-head'},el('div',{},el('h3',{},'Administrative events'),el('p',{},`${state.audit.length} read-only system record${state.audit.length===1?'':'s'}`))),el('div',{class:'table-wrap'},el('table',{class:'table audit-table'},el('thead',{},el('tr',{},...['When','Event','Changed by','Details','Reference'].map(x=>el('th',{},x)))),body))));
}

async function manage() {
  const [settingsPayload,syncPayload]=await Promise.all([api(`${API}/manage-settings`),api(`${API}/directory-sync`)]);
  state.manageSettings=settingsPayload;state.directorySync=syncPayload;
  const settings=settingsPayload;
  const filters=syncPayload.filters||{};
  const organizationName=el('input',{value:settings.organizationName||'',maxlength:160});
  const organizationFields=[['websiteUrl','Website URL'],['facebookUrl','Facebook URL'],['instagramUrl','Instagram URL'],['linkedinUrl','LinkedIn URL'],['xUrl','X URL'],['threadsUrl','Threads URL'],['blueskyUrl','Bluesky URL'],['youtubeUrl','YouTube URL']];
  const organizationInputs=Object.fromEntries(organizationFields.map(([key])=>[key,el('input',{type:'url',value:settings.organizationInfo?.[key]||'',maxlength:2048,placeholder:'https://'})]));
  const locationMappings=el('div',{class:'mapping-list'});
  const mappingRows=[];
  const addLocationMapping=(mapping={})=>{
    const source=el('input',{value:mapping.source||'',maxlength:200,placeholder:'Main office'});
    const output=el('input',{value:mapping.output||'',maxlength:500,placeholder:'Main office | Regional office'});
    const isDefault=el('input',{type:'checkbox',checked:Boolean(mapping.isDefault),'aria-label':'Use when Entra office location is empty'});
    const entry={source,output,isDefault};
    isDefault.onchange=()=>{if(isDefault.checked)mappingRows.forEach(item=>{if(item!==entry)item.isDefault.checked=false;});};
    const row=el('div',{class:'mapping-row'},el('div',{class:'field'},el('label',{},'Entra office location'),source),el('div',{class:'field'},el('label',{},'Rendered locations'),output),el('label',{class:'mapping-default'},isDefault,el('span',{},'Default',el('small',{class:'muted block'},'Use when Entra is blank'))),el('button',{class:'button small subtle mapping-remove',type:'button','aria-label':'Remove location mapping',onclick:()=>{row.remove();const index=mappingRows.indexOf(entry);if(index>=0)mappingRows.splice(index,1);}},'×'));
    entry.row=row;mappingRows.push(entry);locationMappings.append(row);
  };
  (settings.locationMappings||[]).forEach(addLocationMapping);
  const addMapping=el('button',{class:'button small',type:'button',onclick:()=>addLocationMapping()},'Add location mapping');
  const designationOptions=el('div',{class:'mapping-list'});
  const designationRows=[];
  const addDesignation=(item={})=>{
    const key=item.key||'';
    const label=el('input',{value:item.label||'',maxlength:120,placeholder:'CPA, REALTOR®, P.Eng.'});
    const entry={key,label};
    const row=el('div',{class:'designation-row'},el('div',{class:'field'},el('label',{},'Professional designation'),label),el('button',{class:'button small subtle mapping-remove',type:'button','aria-label':'Remove professional designation',onclick:()=>{row.remove();const index=designationRows.indexOf(entry);if(index>=0)designationRows.splice(index,1);}},'×'));
    designationRows.push(entry);designationOptions.append(row);
  };
  (settings.designationOptions||[]).forEach(addDesignation);
  const addDesignationButton=el('button',{class:'button small',type:'button',onclick:()=>addDesignation()},'Add designation');
  const scheduleEnabled=el('input',{type:'checkbox',checked:Boolean(settings.directorySchedule?.enabled),disabled:!settings.directoryConfigured});
  const scheduleInterval=el('select',{},...[[1,'Every hour'],[6,'Every 6 hours'],[12,'Every 12 hours'],[24,'Daily'],[48,'Every 2 days'],[168,'Weekly']].map(([value,label])=>el('option',{value,selected:Number(settings.directorySchedule?.intervalHours)===value},label)));
  const defaultVisible=el('input',{type:'checkbox',checked:settings.directoryDefaults?.visible!==false});
  const defaultApplicable=el('input',{type:'checkbox',checked:settings.directoryDefaults?.applicable!==false});
  const defaultOptOut=el('input',{type:'checkbox',checked:Boolean(settings.directoryDefaults?.canSelfOptOut)});
  const defaultTagline=el('input',{type:'checkbox',checked:Boolean(settings.directoryDefaults?.canChooseTagline)});
  const defaultIdentity=el('select',{},el('option',{value:'signed_in',selected:settings.directoryDefaults?.signatureIdentityMode!=='mailbox'},'Signed-in employee'),el('option',{value:'mailbox',selected:settings.directoryDefaults?.signatureIdentityMode==='mailbox'},'Account / mailbox'));
  const enabled=el('input',{type:'checkbox',checked:filters.enabledOnly!==false});
  const members=el('input',{type:'checkbox',checked:filters.membersOnly!==false});
  const domains=el('input',{value:(filters.allowedDomains||[]).join(', '),placeholder:'example.com'});
  const excluded=el('textarea',{placeholder:'service-*@example.com\nadmin@example.com'},(filters.excludedEmailPatterns||[]).join('\n'));
  const readList=value=>value.split(/[\n,]/).map(item=>item.trim()).filter(Boolean);
  const save=el('button',{class:'button primary',type:'button'},'Save settings');
  save.onclick=async()=>{try{save.disabled=true;await api(`${API}/directory-sync`,{method:'PUT',body:JSON.stringify({filters:{enabledOnly:enabled.checked,membersOnly:members.checked,allowedDomains:readList(domains.value),excludedEmailPatterns:readList(excluded.value)}})});const mappings=mappingRows.map(({source,output,isDefault})=>({source:source.value.trim(),output:output.value.trim(),isDefault:isDefault.checked})).filter(mapping=>mapping.source||mapping.output);const designations=designationRows.map(({key,label})=>({...(key?{key}:{}),label:label.value.trim()})).filter(item=>item.label);const organizationInfo=Object.fromEntries(organizationFields.map(([key])=>[key,organizationInputs[key].value.trim()]));state.manageSettings=await api(`${API}/manage-settings`,{method:'PUT',body:JSON.stringify({organizationName:organizationName.value,organizationInfo,locationMappings:mappings,designationOptions:designations,directorySchedule:{enabled:scheduleEnabled.checked,intervalHours:Number(scheduleInterval.value)},directoryDefaults:{visible:defaultVisible.checked,applicable:defaultApplicable.checked,canSelfOptOut:defaultOptOut.checked,canChooseTagline:defaultTagline.checked,signatureIdentityMode:defaultIdentity.value}})});state.session.branding={organizationName:state.manageSettings.organizationName,...state.manageSettings.organizationInfo};renderBranding();toast('Manage settings saved.');manage();}catch(error){toast(error.message,'error');save.disabled=false;}};
  const syncNow=el('button',{class:'button',type:'button',disabled:!settings.directoryConfigured},settings.directoryConfigured?'Sync now':'Credentials required');
  syncNow.onclick=async()=>{try{syncNow.disabled=true;syncNow.textContent='Syncing…';const response=await api(`${API}/directory-sync/run`,{method:'POST'});toast(`Entra sync complete: ${response.result.created} added, ${response.result.updated} refreshed, ${response.result.filtered} filtered.`);manage();}catch(error){toast(error.message,'error');syncNow.disabled=false;syncNow.textContent='Sync now';}};
  const last=settings.directorySchedule?.lastRunAt;
  const lastResult=settings.directorySchedule?.lastResult;
  const syncStatus=last?`${date(last)} · ${lastResult?.ok===false?'Failed':`${lastResult?.created||0} added, ${lastResult?.updated||0} refreshed`}`:'No scheduled sync has run yet.';
  const file=el('input',{type:'file',accept:'.sqlite,.sqlite3,.db,application/vnd.sqlite3,application/x-sqlite3,application/octet-stream','aria-label':'Choose Cornerstone Signatures database backup'});
  const selected=el('p',{class:'muted backup-selection'},'No backup selected.');
  const restore=el('button',{class:'button danger',type:'button',disabled:true},'Restore backup');
  const download=el('button',{class:'button primary',type:'button'},'Export database');
  const formatBytes=value=>{const bytes=Number(value)||0;if(bytes<1024)return `${bytes} B`;if(bytes<1024**2)return `${(bytes/1024).toFixed(1)} KB`;return `${(bytes/1024**2).toFixed(1)} MB`;};
  const responseError=async response=>{const body=await response.json().catch(()=>({}));return new Error(body.error?.message||body.message||`${response.status} ${response.statusText}`);};

  download.onclick=async()=>{try{download.disabled=true;download.textContent='Preparing export…';const response=await fetch(`${API}/database/export`,{credentials:'same-origin',headers:{Accept:'application/vnd.sqlite3'}});if(!response.ok)throw await responseError(response);const blob=await response.blob();const disposition=response.headers.get('content-disposition')||'';const filename=disposition.match(/filename="([^"]+)"/i)?.[1]||`cornerstone-signatures-backup-${new Date().toISOString().slice(0,10)}.sqlite`;const url=URL.createObjectURL(blob);const link=el('a',{href:url,download:filename});document.body.append(link);link.click();link.remove();URL.revokeObjectURL(url);toast(`Database exported (${formatBytes(blob.size)}).`);}catch(error){toast(error.message,'error');}finally{download.disabled=false;download.textContent='Export database';}};
  file.onchange=()=>{const backup=file.files?.[0];restore.disabled=!backup;selected.textContent=backup?`${backup.name} · ${formatBytes(backup.size)}`:'No backup selected.';};
  restore.onclick=()=>{const backup=file.files?.[0];if(!backup)return;const confirmation=el('input',{placeholder:'Type IMPORT','aria-label':'Type IMPORT to confirm',autocomplete:'off'});const submit=el('button',{class:'button danger',type:'button',disabled:true},'Import and replace data');confirmation.oninput=()=>{submit.disabled=confirmation.value!=='IMPORT';};submit.onclick=async()=>{try{submit.disabled=true;submit.textContent='Validating and importing…';const response=await fetch(`${API}/database/import`,{method:'POST',credentials:'same-origin',headers:{Accept:'application/json','Content-Type':'application/vnd.sqlite3'},body:backup});if(!response.ok)throw await responseError(response);dialog.close();toast('Database restored successfully.');await loadSession();}catch(error){toast(error.message,'error');submit.disabled=false;submit.textContent='Import and replace data';}};showDialog(el('div',{class:'dialog-body database-confirm'},el('h2',{},'Restore this database backup?'),el('p',{},`${backup.name} (${formatBytes(backup.size)}) will replace all current staff, access roles, templates, deployments, settings, and audit history.`),el('div',{class:'danger-note'},el('strong',{},'This cannot be undone from inside Cornerstone Signatures.'),el('p',{},'Export the current database first if you may need to return to it. The backup will be fully validated before any live data is changed.')),el('div',{class:'field'},el('label',{},'Type IMPORT to confirm'),confirmation),el('div',{class:'dialog-actions'},el('button',{class:'button',value:'cancel'},'Cancel'),submit)));};

  const toggle=(title,note,input)=>el('label',{class:'split-row manage-toggle'},el('span',{},el('strong',{},title),el('small',{class:'muted block'},note)),input);
  main.replaceChildren(pageHead('Manage','Configure organization-wide branding, defaults, directory synchronization, and data portability.',save),
    el('div',{class:'manage-sections'},
      el('section',{class:'card card-pad stack'},el('div',{},el('h3',{},'Organization information'),el('p',{class:'muted'},'Reusable organization values for templates. Each field is available through the merge tag shown below; Outlook’s installed add-in name remains controlled by its manifest.')),el('div',{class:'field'},el('label',{},'Organization name'),organizationName,el('small',{class:'code'},'{{organizationName}}')),el('div',{class:'form-grid'},...organizationFields.map(([key,label])=>el('div',{class:'field'},el('label',{},label),organizationInputs[key],el('small',{class:'code'},`{{${key}}}`))))),
      el('section',{class:'card card-pad stack'},el('div',{},el('h3',{},'Location mappings'),el('p',{class:'muted'},'Match an exact Entra office location to the saved text rendered by {{locations}}. Matching ignores capitalization; an unmapped location renders as received from Entra. Optionally choose one mapping as the fallback when Entra has no location.')),locationMappings,el('div',{},addMapping)),
      el('section',{class:'card card-pad stack'},el('div',{},el('h3',{},'Professional designations'),el('p',{class:'muted'},'Maintain the approved values staff can select for {{designations}}. Selections are stored locally because Entra has no standard professional-designations field.')),designationOptions,el('div',{},addDesignationButton)),
      el('section',{class:'card card-pad stack'},el('div',{},el('h3',{},'Microsoft Entra synchronization'),el('p',{class:'muted'},settings.directoryConfigured?'Graph credentials connected. Configure filters, automate refreshes, or run one immediately.':'Graph credentials are not configured in the application environment.')),el('div',{class:'form-grid'},el('div',{class:'field'},el('label',{},'Allowed email domains'),domains,el('small',{},'Comma-separated; leave empty to allow every domain.')),el('div',{class:'field'},el('label',{},'Excluded email patterns'),excluded,el('small',{},'One wildcard pattern per line; * and ? are supported.'))),toggle('Enabled accounts only','Skip disabled Entra accounts.',enabled),toggle('Member users only','Skip guest accounts.',members),el('div',{class:'schedule-row'},toggle('Scheduled synchronization','Run automatically in this Cornerstone Signatures service.',scheduleEnabled),el('div',{class:'field'},el('label',{},'Frequency'),scheduleInterval)),el('p',{class:'muted'},syncStatus),el('div',{},syncNow)),
      el('section',{class:'card card-pad stack'},el('div',{},el('h3',{},'New account defaults & preferences'),el('p',{class:'muted'},'Applied only when a matching account is first added by Entra. Existing staff settings are never rewritten.')),toggle('Visible in staff picker','Show newly synced accounts on the root picker.',defaultVisible),toggle('Signature applicable','Enable managed delivery for newly synced accounts.',defaultApplicable),toggle('Allow self-service opt-out','Let new accounts pause automatic delivery.',defaultOptOut),toggle('Allow tagline choice','Let new accounts select an approved tagline.',defaultTagline),el('div',{class:'field'},el('label',{},'Shared sending identity default'),defaultIdentity)),
      el('section',{class:'card card-pad stack data-management'},el('div',{},el('h3',{},'Data management'),el('p',{class:'muted'},'Backups contain staff data, roles, templates, deployments, settings, and audit history. Store them securely.')),el('div',{class:'grid two database-grid'},el('div',{class:'stack'},el('h4',{},'Export database'),el('p',{class:'muted'},'Download a consistent point-in-time SQLite backup while Cornerstone Signatures remains online.'),el('div',{class:'database-action'},download)),el('div',{class:'stack'},el('h4',{},'Import database'),el('p',{class:'muted'},'Restore a fully validated Cornerstone Signatures backup and replace current managed state.'),el('label',{class:'file-picker'},file,el('span',{},'Choose backup file')),selected,el('div',{class:'database-action'},restore))))));
}

window.addEventListener('hashchange',navigate);
const sidebar=document.querySelector('.sidebar');
const menuButton=document.querySelector('#menu-button');
const setSidebarOpen=open=>{sidebar.classList.toggle('open',open);document.body.classList.toggle('sidebar-open',open);menuButton.setAttribute('aria-expanded',String(open));if(open)document.querySelector('#sidebar-close').focus();};
menuButton.addEventListener('click',()=>setSidebarOpen(!sidebar.classList.contains('open')));
document.querySelector('#sidebar-close').addEventListener('click',()=>{setSidebarOpen(false);menuButton.focus();});
document.querySelector('#sidebar-backdrop').addEventListener('click',()=>setSidebarOpen(false));
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&sidebar.classList.contains('open')){setSidebarOpen(false);menuButton.focus();}});
window.matchMedia('(min-width: 761px)').addEventListener('change',event=>{if(event.matches)setSidebarOpen(false);});
document.querySelector('.dialog-close').addEventListener('click',()=>dialog.close());
dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
loading(); loadSession();
