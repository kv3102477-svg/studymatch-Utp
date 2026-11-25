const $=id=>document.getElementById(id);
let csrf="", report="emparejamientos", peopleTab="estudiantes", currentAdminEmail="";
const cache={users:new Map(),administradores:null,cursos:null,carreras:null,reportes:new Map(),catalogos:null};
function escapeHtml(v){return String(v??"").replace(/[&<>\"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
function toast(message){$("toast").textContent=message;$("toast").classList.add("show");setTimeout(()=>$("toast").classList.remove("show"),2800);}
async function request(path,options={}){
  const headers={"Content-Type":"application/json",...(options.headers||{})};
  if(options.method&&options.method!=="GET")headers["X-CSRF-Token"]=csrf;
  const response=await fetch("/api/admin"+path,{credentials:"same-origin",...options,headers});
  let data={};try{data=await response.json();}catch{}
  if(!response.ok)throw Error(data.error||data.message||"No se pudo completar la operación.");
  return data;
}
async function loadCsrf(){const response=await fetch("/api/admin/csrf",{credentials:"same-origin"});csrf=(await response.json()).token;}
function showApp(name,email){$("admin-name").textContent=name;$("welcome-name").textContent=name.split(" ")[0];currentAdminEmail=(email||"").toLowerCase();$("login").classList.add("hidden");$("app").classList.remove("hidden");}
async function login(){
  $("login-error").textContent="";
  try{await loadCsrf();const d=await request("/login",{method:"POST",body:JSON.stringify({correo:$("email").value,contrasena:$("password").value})});csrf=d.csrf;showApp(d.nombre,d.correo);await loadSummary();}
  catch(e){$("login-error").textContent=e.message;}
}
function showAuth(section){["login","recover","reset"].forEach(id=>$(id).classList.toggle("hidden",id!==section));}
document.querySelectorAll("[data-toggle-password]").forEach(button=>{
  button.addEventListener("click",()=>{
    const input=$(button.dataset.togglePassword),showPassword=input.type==="password";
    input.type=showPassword?"text":"password";
    button.setAttribute("aria-pressed",String(showPassword));
    button.setAttribute("aria-label",showPassword?"Ocultar contraseña":"Mostrar contraseña");
    button.querySelector(".eye-open").classList.toggle("hidden",showPassword);
    button.querySelector(".eye-closed").classList.toggle("hidden",!showPassword);
  });
});
async function restore(){await loadCsrf();try{const me=await request("/me");showApp(me.nombre,me.correo);await loadSummary();}catch{}}
async function loadSummary(){const d=await request("/resumen");$("stat-users").textContent=d.usuarios;$("stat-active").textContent=d.usuarios_activos;$("stat-courses").textContent=d.cursos;$("stat-careers").textContent=d.carreras;}
async function loadUsers(force=false){
  const q=$("user-search").value,key=q.toLowerCase();
  if(!force&&cache.users.has(key)){renderUsers(cache.users.get(key));return;}
  $("users-body").innerHTML='<tr><td colspan="5" class="empty">Cargando estudiantes…</td></tr>';
  const rows=await request("/usuarios?q="+encodeURIComponent(q));cache.users.set(key,rows);renderUsers(rows);
}
function renderUsers(rows){
  $("users-body").innerHTML=rows.length?rows.map(u=>'<tr><td><b>'+escapeHtml(u.nombre)+'</b></td><td>'+escapeHtml(u.correo)+'</td><td>'+escapeHtml(u.carrera||"—")+'</td><td><span class="pill '+(u.cuenta_activa?"":"off")+'">'+(u.cuenta_activa?"Activo":"Desactivado")+'</span></td><td><button class="action" data-user="'+u.id+'" data-active="'+(!u.cuenta_activa)+'">'+(u.cuenta_activa?"Desactivar":"Activar")+'</button></td></tr>').join(""):'<tr><td colspan="5" class="empty">No se encontraron estudiantes.</td></tr>';
}
async function loadAdmins(force=false){
  if(!force&&cache.administradores){renderAdmins(cache.administradores);return;}
  $("admins-body").innerHTML='<tr><td colspan="4" class="empty">Cargando administradores…</td></tr>';
  const rows=await request("/administradores");cache.administradores=rows;renderAdmins(rows);
}
function renderAdmins(rows){
  $("admins-body").innerHTML=rows.length?rows.map(a=>{
    const self=String(a.correo).toLowerCase()===currentAdminEmail;
    const actions=self?'<small>Sesión actual</small>':'<button class="action" data-admin-state="'+a.id+'" data-active="'+(!a.activo)+'">'+(a.activo?"Desactivar":"Activar")+'</button> <button class="action danger" data-admin-delete="'+a.id+'" data-email="'+escapeHtml(a.correo)+'">Eliminar</button>';
    return '<tr><td><b>'+escapeHtml(a.nombre)+'</b></td><td>'+escapeHtml(a.correo)+'</td><td><span class="pill '+(a.activo?"":"off")+'">'+(a.activo?"Activo":"Desactivado")+'</span></td><td>'+actions+'</td></tr>';
  }).join(""):'<tr><td colspan="4" class="empty">Aún no hay perfiles administrativos.</td></tr>';
}
async function loadCatalog(type,force=false){
  const body=$(type==="cursos"?"courses-body":"careers-body");
  if(!force&&cache[type]){renderCatalog(type,cache[type]);return;}
  body.innerHTML='<tr><td colspan="3" class="empty">Cargando…</td></tr>';
  const rows=await request("/"+type);cache[type]=rows;renderCatalog(type,rows);
}
async function loadCourseRequests(){
  const body=$("course-requests-body");
  body.innerHTML='<tr><td colspan="5" class="empty">Cargando solicitudes…</td></tr>';
  const rows=await request("/cursos/solicitudes");
  body.innerHTML=rows.length?rows.map(x=>'<tr><td><b>'+escapeHtml(x.curso)+'</b></td><td>'+escapeHtml(x.solicitante)+'<br><small>'+escapeHtml(x.correo)+'</small></td><td>'+escapeHtml(x.mensaje)+'</td><td>'+escapeHtml(String(x.creado_en).slice(0,16).replace("T"," "))+'</td><td><button class="action" data-approve-course-request="'+x.id+'">Agregar al catálogo</button></td></tr>').join(''):'<tr><td colspan="5" class="empty">No hay solicitudes pendientes.</td></tr>';
}
function renderCatalog(type,rows){
  const body=$(type==="cursos"?"courses-body":"careers-body");
  body.innerHTML=rows.length?rows.map(x=>'<tr><td>'+escapeHtml(x.nombre)+'</td><td><span class="pill '+(x.activo?"":"off")+'">'+(x.activo?"Disponible":"Inactivo")+'</span></td><td><button class="action" data-kind="'+type+'" data-id="'+x.id+'" data-active="'+(!x.activo)+'">'+(x.activo?"Desactivar":"Activar")+'</button></td></tr>').join(""):'<tr><td colspan="3" class="empty">Aún no hay registros.</td></tr>';
}
async function loadStudentCatalogs(){
  if(cache.catalogos)return cache.catalogos;
  cache.catalogos=await request("/catalogos-estudiante");return cache.catalogos;
}
async function showStudentForm(){
  $("student-form").classList.toggle("hidden");
  if($("student-form").classList.contains("hidden"))return;
  try{
    const data=await loadStudentCatalogs();
    $("student-career").innerHTML='<option value="">Carrera (opcional)</option>'+data.carreras.map(x=>'<option>'+escapeHtml(x.nombre)+'</option>').join("");
    $("student-cycle").innerHTML='<option value="">Ciclo (opcional)</option>'+data.ciclos.map(x=>'<option>'+escapeHtml(x.nombre)+'</option>').join("");
  }catch(e){toast(e.message);}
}
function metrics(items){return '<div class="report-cards">'+items.map(([label,value])=>'<div class="metric"><small>'+label+'</small><b>'+value+'</b></div>').join("")+'</div>';}
function params(){return new URLSearchParams({desde:$("from-date").value,hasta:$("to-date").value});}
async function reportData(path,force){if(!force&&cache.reportes.has(path))return cache.reportes.get(path);const data=await request(path);cache.reportes.set(path,data);return data;}
async function runReport(force=false){
  const p=params();
  $("report-output").innerHTML='<div class="card loading">Cargando reporte…</div>';
  if(report==="emparejamientos"){
    const d=await reportData("/reportes/emparejamientos?"+p,force),series=d.serie||[],max=Math.max(1,...series.map(x=>Number(x.aceptados)));
    const estados=(d.estados||[]).map(x=>escapeHtml(x.estado)+" "+x.cantidad).join(" · ");
    const aviso=d.aceptados===0?'<div class="notice">No hay emparejamientos aceptados en este periodo. Estado de las solicitudes creadas: '+(estados||"sin solicitudes")+"</div>":"";
    $("report-output").innerHTML=metrics([["Emparejamientos aceptados",d.aceptados],["Solicitudes creadas",d.total],["Periodo",escapeHtml(d.desde)+" – "+escapeHtml(d.hasta)]])+aviso+'<div class="card"><h3>Emparejamientos aceptados por día</h3><div class="bar-list">'+(series.length?series.map(x=>'<div class="bar-row"><span>'+escapeHtml(String(x.dia).slice(0,10))+'</span><div class="bar"><i style="width:'+Math.max(2,Number(x.aceptados)*100/max)+'%"></i></div><b>'+x.aceptados+'</b></div>').join(""):'<div class="empty">No hubo emparejamientos aceptados en estas fechas.</div>')+'</div></div>';
  }else if(report==="satisfaccion"){
    const d=await reportData("/reportes/satisfaccion?"+p,force),stars=d.por_estrellas||{},max=Math.max(1,...Object.values(stars).map(Number));
    const aviso=d.total===0?'<div class="notice">No hay calificaciones en este periodo. Amplía las fechas para consultar otros periodos.</div>':"";
    $("report-output").innerHTML=metrics([["Calificaciones recibidas",d.total],["Promedio",d.total?Number(d.promedio).toFixed(2)+" / 5":"Sin calificaciones"],["Periodo",escapeHtml(d.desde)+" – "+escapeHtml(d.hasta)]])+aviso+'<div class="card"><h3>Distribución de satisfacción</h3><div class="bar-list">'+[5,4,3,2,1].map(n=>'<div class="bar-row"><span>'+n+' estrellas</span><div class="bar"><i style="width:'+(Number(stars[n])?Math.max(2,Number(stars[n])*100/max):0)+'%"></i></div><b>'+Number(stars[n]||0)+'</b></div>').join("")+'</div></div>';
  }else{
    const course=$("course-filter")?.value||"";if(course)p.set("curso",course);
    const d=await reportData("/reportes/asesorias?"+p,force),rows=d.detalle||[];
    $("report-output").innerHTML='<div class="toolbar"><div><h3>Asesorías completadas por curso</h3><p>Sesiones marcadas como completadas.</p></div><select id="course-filter" class="search"><option value="">Todos los cursos</option>'+d.cursos.map(x=>'<option value="'+x.id+'" '+(String(x.id)===course?"selected":"")+'>'+escapeHtml(x.nombre)+'</option>').join("")+'</select></div>'+metrics([["Asesorías completadas",rows.reduce((a,x)=>a+Number(x.asesorias),0)],["Horas registradas",(rows.reduce((a,x)=>a+Number(x.minutos),0)/60).toFixed(1)],["Cursos con actividad",rows.length]])+'<div class="card table-wrap"><table><thead><tr><th>Curso</th><th>Asesorías</th><th>Horas</th></tr></thead><tbody>'+(rows.length?rows.map(x=>'<tr><td>'+escapeHtml(x.curso)+'</td><td>'+x.asesorias+'</td><td>'+(Number(x.minutos)/60).toFixed(1)+'</td></tr>').join(""):'<tr><td colspan="3" class="empty">No hay asesorías para este periodo.</td></tr>')+'</tbody></table></div>';
    $("course-filter").onchange=()=>runReport().catch(e=>toast(e.message));
  }
}
function navigate(name){
  document.querySelectorAll(".page").forEach(x=>x.classList.add("hidden"));$("page-"+name).classList.remove("hidden");
  document.querySelectorAll(".nav").forEach(x=>x.classList.toggle("active",x.dataset.page===name));
  $("page-title").textContent={inicio:"Resumen",reportes:"Reportes",usuarios:"Personas",cursos:"Cursos",carreras:"Carreras"}[name];
  const action=name==="usuarios"?(peopleTab==="estudiantes"?()=>loadUsers():()=>loadAdmins()):name==="cursos"?()=>Promise.all([loadCatalog("cursos"),loadCourseRequests()]):name==="carreras"?()=>loadCatalog("carreras"):name==="reportes"?()=>runReport():null;
  if(action)action().catch(e=>toast(e.message));
}
function changePeopleTab(tab){
  peopleTab=tab;
  document.querySelectorAll(".person-tab").forEach(x=>x.classList.toggle("active",x.dataset.personTab===tab));
  $("people-students").classList.toggle("hidden",tab!=="estudiantes");
  $("people-admins").classList.toggle("hidden",tab!=="administradores");
  (tab==="estudiantes"?loadUsers():loadAdmins()).catch(e=>toast(e.message));
}
$("login-form").onsubmit=e=>{e.preventDefault();login();};
$("forgot-password").onclick=e=>{e.preventDefault();$("recover-email").value=$("email").value;$("recover-message").textContent="";showAuth("recover");};
$("back-to-login").onclick=e=>{e.preventDefault();showAuth("login");};
$("recover-form").onsubmit=async e=>{
  e.preventDefault();$("recover-message").textContent="";$("recover-message").classList.remove("success-message");
  try{await loadCsrf();const d=await request("/recuperar",{method:"POST",body:JSON.stringify({correo:$("recover-email").value})});$("recover-message").textContent=d.mensaje;$("recover-message").classList.toggle("success-message",d.enviado);$("recover-message").classList.toggle("error",!d.enviado);}
  catch(x){$("recover-message").textContent=x.message;}
};
const resetToken=new URLSearchParams(location.search).get("reset");
$("reset-form").onsubmit=async e=>{
  e.preventDefault();$("reset-message").textContent="";
  try{await loadCsrf();const d=await request("/restablecer",{method:"POST",body:JSON.stringify({token:resetToken,contrasena:$("reset-password").value})});$("reset-message").textContent=d.mensaje;$("reset-message").classList.remove("error");setTimeout(()=>location.href="/admin.html",1800);}
  catch(x){$("reset-message").textContent=x.message;}
};
$("logout").onclick=async()=>{try{await request("/logout",{method:"POST"});location.reload();}catch(e){toast(e.message);}};
document.querySelectorAll(".nav").forEach(b=>b.onclick=()=>navigate(b.dataset.page));
document.querySelectorAll("[data-go]").forEach(b=>b.onclick=()=>navigate(b.dataset.go));
document.querySelectorAll(".person-tab").forEach(b=>b.onclick=()=>changePeopleTab(b.dataset.personTab));
document.querySelectorAll(".report-tab").forEach(b=>b.onclick=()=>{report=b.dataset.report;document.querySelectorAll(".report-tab").forEach(x=>x.classList.toggle("active",x===b));runReport().catch(e=>toast(e.message));});
$("run-report").onclick=()=>runReport(true).catch(e=>toast(e.message));
let searchTimer;$("user-search").oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>loadUsers(true).catch(e=>toast(e.message)),250);};
$("show-student-form").onclick=showStudentForm;
$("show-admin-form").onclick=()=>$("admin-form").classList.toggle("hidden");
$("users-body").onclick=async e=>{
  const b=e.target.closest("[data-user]");if(!b)return;
  try{await request("/usuarios/"+b.dataset.user+"/estado",{method:"PATCH",body:JSON.stringify({activo:b.dataset.active==="true"})});cache.users.clear();toast("Estado actualizado.");await loadUsers(true);await loadSummary();}
  catch(x){toast(x.message);}
};
$("admins-body").onclick=async e=>{
  const state=e.target.closest("[data-admin-state]"),del=e.target.closest("[data-admin-delete]");
  try{
    if(state){await request("/administradores/"+state.dataset.adminState+"/estado",{method:"PATCH",body:JSON.stringify({activo:state.dataset.active==="true"})});}
    else if(del){if(!confirm("¿Eliminar el perfil de administrador "+del.dataset.email+"? Esta acción no se puede deshacer."))return;await request("/administradores/"+del.dataset.adminDelete,{method:"DELETE"});}
    else return;
    cache.administradores=null;toast("Perfiles administrativos actualizados.");await loadAdmins(true);
  }catch(x){toast(x.message);}
};
document.body.onclick=async e=>{
  const approve=e.target.closest("[data-approve-course-request]");
  if(approve){
    approve.disabled=true;
    try{await request("/cursos/solicitudes/"+approve.dataset.approveCourseRequest+"/aprobar",{method:"POST"});cache.cursos=null;toast("Curso agregado al catálogo.");await Promise.all([loadCatalog("cursos",true),loadCourseRequests(),loadSummary()]);}
    catch(x){approve.disabled=false;toast(x.message);}
    return;
  }
  const b=e.target.closest("[data-kind]");if(!b)return;
  try{await request("/"+b.dataset.kind+"/"+b.dataset.id+"/estado",{method:"PATCH",body:JSON.stringify({activo:b.dataset.active==="true"})});cache[b.dataset.kind]=null;toast("Estado actualizado.");await loadCatalog(b.dataset.kind,true);await loadSummary();}
  catch(x){toast(x.message);}
};
$("student-form").onsubmit=async e=>{
  e.preventDefault();
  const form={nombre:$("student-name").value,correo:$("student-email").value,contrasena:$("student-password").value,carrera:$("student-career").value,ciclo:$("student-cycle").value};
  try{await request("/usuarios",{method:"POST",body:JSON.stringify(form)});$("student-form").reset();$("student-form").classList.add("hidden");cache.users.clear();toast("Estudiante agregado.");await loadUsers(true);await loadSummary();}
  catch(x){toast(x.message);}
};
$("admin-form").onsubmit=async e=>{
  e.preventDefault();
  const form={nombre:$("admin-profile-name").value,correo:$("admin-profile-email").value,contrasena:$("admin-profile-password").value};
  try{await request("/administradores",{method:"POST",body:JSON.stringify(form)});$("admin-form").reset();$("admin-form").classList.add("hidden");cache.administradores=null;toast("Administrador agregado.");await loadAdmins(true);}
  catch(x){toast(x.message);}
};
$("course-form").onsubmit=async e=>{
  e.preventDefault();
  try{await request("/cursos",{method:"POST",body:JSON.stringify({nombre:$("course-name").value})});$("course-name").value="";cache.cursos=null;toast("Curso guardado.");await loadCatalog("cursos",true);await loadSummary();}
  catch(x){toast(x.message);}
};
$("career-form").onsubmit=async e=>{
  e.preventDefault();
  try{await request("/carreras",{method:"POST",body:JSON.stringify({nombre:$("career-name").value})});$("career-name").value="";cache.carreras=null;cache.catalogos=null;toast("Carrera guardada.");await loadCatalog("carreras",true);await loadSummary();}
  catch(x){toast(x.message);}
};
function localISO(d){return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)}
const end=new Date(),start=new Date();start.setFullYear(start.getFullYear()-1);$("to-date").value=localISO(end);$("from-date").value=localISO(start);
if(resetToken){showAuth("reset");loadCsrf().catch(()=>{});}else{restore().catch(()=>{});}
