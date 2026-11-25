package com.studymatch.controller.admin;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.sql.Timestamp;
import java.time.LocalDate;
import java.util.*;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.beans.factory.annotation.Value;
import com.studymatch.service.RecoveryService;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.transaction.annotation.Transactional;

@RestController
@RequestMapping("/api/admin")
public class AdminApi {
    private final JdbcTemplate db;
    private final BCryptPasswordEncoder passwords;
    private final RecoveryService recovery;
    @Value("${APP_URL:http://localhost:8085}") private String appUrl;
    public AdminApi(JdbcTemplate db, BCryptPasswordEncoder passwords, RecoveryService recovery) { this.db=db; this.passwords=passwords; this.recovery=recovery; }

    private String hash(String token) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))); }
        catch (java.security.NoSuchAlgorithmException e) { throw new IllegalStateException(e); }
    }

    private void csrf(HttpSession s, String given) {
        Object expected=s.getAttribute("adminCsrf");
        if (!(expected instanceof String token) || given==null || !MessageDigest.isEqual(token.getBytes(StandardCharsets.UTF_8),given.getBytes(StandardCharsets.UTF_8)))
            throw new ResponseStatusException(HttpStatus.FORBIDDEN,"La sesión venció. Recarga la página e inténtalo de nuevo.");
    }
    private String admin(HttpSession s) {
        Object email=s.getAttribute("adminEmail");
        if (!(email instanceof String)) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Inicia sesión como administrador.");
        List<Map<String,Object>> rows=db.queryForList("SELECT contrasena_hash FROM admin_usuario WHERE lower(correo)=lower(?) AND activo=true",email);
        if (rows.isEmpty() || !Objects.equals(s.getAttribute("adminPasswordHash"),rows.get(0).get("contrasena_hash"))) {
            s.removeAttribute("adminEmail"); s.removeAttribute("adminPasswordHash"); s.removeAttribute("adminCsrf");
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"Tu sesión administrativa venció. Inicia sesión nuevamente.");
        }
        return (String)email;
    }
    @GetMapping("/csrf") public Object token(HttpSession s) {
        if(s.getAttribute("adminCsrf")==null) s.setAttribute("adminCsrf",UUID.randomUUID().toString());
        return Map.of("token",s.getAttribute("adminCsrf"));
    }
    @PostMapping("/recuperar") public Object recuperar(@RequestBody Map<String,String> input,HttpSession s,@RequestHeader(value="X-CSRF-Token",required=false) String token) {
        csrf(s,token);
        String email=Objects.toString(input.get("correo"),"").trim().toLowerCase(Locale.ROOT);
        if (email.length()>160 || !email.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$"))
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Escribe un correo válido.");
        List<Map<String,Object>> rows=db.queryForList("SELECT id,correo,activo FROM admin_usuario WHERE lower(correo)=?",email);
        if (rows.isEmpty()) return Map.of("mensaje","No hay una cuenta administrativa registrada con ese correo.","enviado",false);
        if (!Boolean.TRUE.equals(rows.get(0).get("activo"))) return Map.of("mensaje","La cuenta administrativa está desactivada. Contacta con soporte.","enviado",false);
        long id=((Number)rows.get(0).get("id")).longValue();
        byte[] bytes=new byte[32]; new SecureRandom().nextBytes(bytes);
        String resetToken=HexFormat.of().formatHex(bytes);
        db.update("UPDATE admin_recuperacion SET usado=true WHERE admin_id=? AND usado=false",id);
        db.update("INSERT INTO admin_recuperacion(admin_id,token_hash,expira_en) VALUES (?,?,CURRENT_TIMESTAMP + INTERVAL '30 minutes')",id,hash(resetToken));
        recovery.sendAdminRecovery(Objects.toString(rows.get(0).get("correo")),appUrl.replaceAll("/$","")+"/admin.html?reset="+resetToken);
        return Map.of("mensaje","Te enviamos un enlace para restablecer la contraseña al correo registrado.","enviado",true);
    }
    @PostMapping("/restablecer") public Object restablecer(@RequestBody Map<String,String> input,HttpSession s,@RequestHeader(value="X-CSRF-Token",required=false) String token) {
        csrf(s,token);
        String resetToken=Objects.toString(input.get("token"),"");
        String raw=Objects.toString(input.get("contrasena"),"");
        if (!resetToken.matches("[a-f0-9]{64}") || raw.length()<12 || raw.getBytes(StandardCharsets.UTF_8).length>72)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El enlace debe ser válido y la contraseña tener entre 12 y 72 bytes.");
        List<Map<String,Object>> rows=db.queryForList("SELECT admin_id FROM admin_recuperacion WHERE token_hash=? AND usado=false AND expira_en>CURRENT_TIMESTAMP",hash(resetToken));
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El enlace venció o ya fue utilizado. Solicita uno nuevo.");
        long id=((Number)rows.get(0).get("admin_id")).longValue();
        db.update("UPDATE admin_usuario SET contrasena_hash=? WHERE id=?",passwords.encode(raw),id);
        db.update("UPDATE admin_recuperacion SET usado=true WHERE admin_id=?",id);
        return Map.of("mensaje","Contraseña actualizada. Inicia sesión.");
    }
    @PostMapping("/login") public Object login(@RequestBody Map<String,String> input,HttpSession s,HttpServletRequest request,@RequestHeader(value="X-CSRF-Token",required=false) String token) {
        csrf(s,token);
        String email=Objects.toString(input.get("correo"),"").trim().toLowerCase();
        String raw=Objects.toString(input.get("contrasena"),"");
        List<Map<String,Object>> rows=db.queryForList("SELECT correo,nombre,contrasena_hash,activo FROM admin_usuario WHERE lower(correo)=?",email);
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"No existe una cuenta administrativa registrada con ese correo.");
        if(!Boolean.TRUE.equals(rows.get(0).get("activo"))) throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"La cuenta administrativa está desactivada. Contacta con soporte.");
        if(!passwords.matches(raw,Objects.toString(rows.get(0).get("contrasena_hash"),"")))
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED,"La contraseña ingresada es incorrecta.");
        String name=Objects.toString(rows.get(0).get("nombre"),"Administrador");
        request.changeSessionId();
        s.setAttribute("adminEmail",email);
        s.setAttribute("adminPasswordHash",rows.get(0).get("contrasena_hash"));
        String newToken=UUID.randomUUID().toString(); s.setAttribute("adminCsrf",newToken);
        return Map.of("correo",email,"nombre",name,"csrf",newToken);
    }
    @GetMapping("/me") public Object me(HttpSession s) {
        String email=admin(s);
        return db.queryForMap("SELECT correo,nombre FROM admin_usuario WHERE lower(correo)=lower(?) AND activo=true",email);
    }
    @PostMapping("/logout") public Object logout(HttpSession s,@RequestHeader(value="X-CSRF-Token",required=false) String token) {
        csrf(s,token); admin(s); s.removeAttribute("adminEmail"); s.removeAttribute("adminPasswordHash"); s.removeAttribute("adminCsrf"); return Map.of("mensaje","Sesión cerrada.");
    }
    @GetMapping("/resumen") public Object resumen(HttpSession s) {
        admin(s);
        return db.queryForMap("SELECT (SELECT count(*) FROM estudiante) usuarios, (SELECT count(*) FROM estudiante WHERE cuenta_activa=true) usuarios_activos, (SELECT count(*) FROM materia WHERE activo=true) cursos, (SELECT count(*) FROM carrera WHERE activo=true) carreras");
    }
    @GetMapping("/usuarios") public Object usuarios(HttpSession s,@RequestParam(defaultValue="") String q) {
        admin(s); String f="%"+q.trim()+"%";
        return db.queryForList("SELECT id,nombre,correo,carrera,ciclo,cuenta_activa,creado_en FROM estudiante WHERE nombre ILIKE ? OR correo ILIKE ? ORDER BY creado_en DESC LIMIT 500",f,f);
    }
    @PatchMapping("/usuarios/{id}/estado") public Object estadoUsuario(HttpSession s,@PathVariable long id,@RequestBody Map<String,Object> body,@RequestHeader(value="X-CSRF-Token",required=false) String token) {
        csrf(s,token); admin(s);
        int n=db.update("UPDATE estudiante SET cuenta_activa=? WHERE id=?",Boolean.TRUE.equals(body.get("activo")),id);
        if(n==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Usuario no encontrado.");
        return Map.of("mensaje","Estado actualizado.");
    }
    @GetMapping("/cursos") public Object cursos(HttpSession s) { admin(s); return db.queryForList("SELECT id,nombre,activo FROM materia ORDER BY nombre"); }
    @GetMapping("/cursos/solicitudes") public Object solicitudesCursos(HttpSession s) {
        admin(s);
        return db.queryForList("SELECT ss.id,substring(ss.asunto from 31) curso,ss.mensaje,ss.creado_en,e.nombre solicitante,e.correo FROM solicitud_soporte ss JOIN estudiante e ON e.id=ss.estudiante_id WHERE ss.tipo='SOPORTE' AND ss.categoria='Sugerencias y Otros' AND ss.estado='PENDIENTE' AND ss.asunto LIKE 'Solicitud para agregar curso:%' ORDER BY ss.creado_en,ss.id");
    }
    @PostMapping("/cursos/solicitudes/{id}/aprobar") @Transactional public Object aprobarSolicitudCurso(HttpSession s,@PathVariable long id,@RequestHeader(value="X-CSRF-Token",required=false)String t) {
        csrf(s,t); admin(s);
        List<Map<String,Object>> rows=db.queryForList("SELECT asunto FROM solicitud_soporte WHERE id=? AND tipo='SOPORTE' AND categoria='Sugerencias y Otros' AND estado='PENDIENTE' AND asunto LIKE 'Solicitud para agregar curso:%' FOR UPDATE",id);
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"La solicitud ya no está pendiente o no existe.");
        String nombre=Objects.toString(rows.get(0).get("asunto"),"").replaceFirst("^Solicitud para agregar curso:\\s*","").trim();
        if(nombre.isBlank() || nombre.length()>100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"La solicitud no contiene un nombre de curso válido (máximo 100 caracteres).");
        db.update("INSERT INTO materia(nombre,activo) VALUES (?,true) ON CONFLICT(nombre) DO UPDATE SET activo=true",nombre);
        db.update("UPDATE solicitud_soporte SET estado='RESUELTO' WHERE id=?",id);
        return Map.of("mensaje","Curso agregado al catálogo y solicitud marcada como resuelta.");
    }
    @PostMapping("/cursos") public Object crearCurso(HttpSession s,@RequestBody Map<String,String>b,@RequestHeader(value="X-CSRF-Token",required=false)String t) {
        csrf(s,t); admin(s); String name=Objects.toString(b.get("nombre"),"").trim();
        if(name.isBlank()||name.length()>100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Escribe un nombre de curso de hasta 100 caracteres.");
        db.update("INSERT INTO materia(nombre,activo) VALUES (?,true) ON CONFLICT(nombre) DO UPDATE SET activo=true",name);
        return Map.of("mensaje","Curso guardado.");
    }
    @PatchMapping("/cursos/{id}/estado") public Object estadoCurso(HttpSession s,@PathVariable long id,@RequestBody Map<String,Object>b,@RequestHeader(value="X-CSRF-Token",required=false)String t) {
        csrf(s,t); admin(s); int n=db.update("UPDATE materia SET activo=? WHERE id=?",Boolean.TRUE.equals(b.get("activo")),id);
        if(n==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Curso no encontrado."); return Map.of("mensaje","Estado actualizado.");
    }
    @GetMapping("/carreras") public Object carreras(HttpSession s) { admin(s); return db.queryForList("SELECT id,nombre,activo FROM carrera ORDER BY nombre"); }
    @PostMapping("/carreras") public Object crearCarrera(HttpSession s,@RequestBody Map<String,String>b,@RequestHeader(value="X-CSRF-Token",required=false)String t) {
        csrf(s,t); admin(s); String name=Objects.toString(b.get("nombre"),"").trim();
        if(name.isBlank()||name.length()>100) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Escribe el nombre de la carrera (máximo 100 caracteres).");
        db.update("INSERT INTO carrera(nombre,activo) VALUES (?,true) ON CONFLICT(nombre) DO UPDATE SET activo=true",name);
        return Map.of("mensaje","Carrera guardada.");
    }
    @PatchMapping("/carreras/{id}/estado") public Object estadoCarrera(HttpSession s,@PathVariable long id,@RequestBody Map<String,Object>b,@RequestHeader(value="X-CSRF-Token",required=false)String t) {
        csrf(s,t); admin(s); int n=db.update("UPDATE carrera SET activo=? WHERE id=?",Boolean.TRUE.equals(b.get("activo")),id);
        if(n==0) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Carrera no encontrada."); return Map.of("mensaje","Estado actualizado.");
    }
    @GetMapping("/catalogos-estudiante") public Object catalogosEstudiante(HttpSession s) {
        admin(s);
        return Map.of("carreras",db.queryForList("SELECT nombre FROM carrera WHERE activo=true ORDER BY nombre"),
            "ciclos",db.queryForList("SELECT nombre FROM ciclo_estudio WHERE activo=true ORDER BY orden,nombre"));
    }
    @PostMapping("/usuarios") public Object crearEstudiante(HttpSession s,@RequestBody Map<String,String> b,@RequestHeader(value="X-CSRF-Token",required=false)String t) {
        csrf(s,t); admin(s);
        String nombre=Objects.toString(b.get("nombre"),"").trim();
        String correo=Objects.toString(b.get("correo"),"").trim().toLowerCase();
        String clave=Objects.toString(b.get("contrasena"),"");
        String carrera=Objects.toString(b.get("carrera"),"").trim();
        String ciclo=Objects.toString(b.get("ciclo"),"").trim();
        if(nombre.isBlank()||nombre.length()>100||!correo.matches("^[^\\s@]+@utp\\.edu\\.pe$")||clave.length()<8||clave.getBytes(StandardCharsets.UTF_8).length>72)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Revisa nombre, correo institucional y contraseña (8 a 72 bytes).");
        if(!carrera.isBlank()&&db.queryForObject("SELECT count(*) FROM carrera WHERE nombre=? AND activo=true",Integer.class,carrera)==0)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"La carrera seleccionada no está disponible.");
        if(!ciclo.isBlank()&&db.queryForObject("SELECT count(*) FROM ciclo_estudio WHERE nombre=? AND activo=true",Integer.class,ciclo)==0)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El ciclo seleccionado no está disponible.");
        if(db.queryForObject("SELECT count(*) FROM estudiante WHERE lower(correo)=?",Integer.class,correo)>0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Ya existe una cuenta con ese correo.");
        Long id=db.queryForObject("WITH nuevo AS (INSERT INTO estudiante(correo,contrasena_hash,nombre,carrera,ciclo,correo_verificado) VALUES (?,?,?,?,?,true) RETURNING id) INSERT INTO suscripcion(estudiante_id,estado,es_trial,fecha_inicio) SELECT id,'GRATUITO',false,CURRENT_DATE FROM nuevo RETURNING estudiante_id",
            Long.class,correo,passwords.encode(clave),nombre,carrera.isBlank()?null:carrera,ciclo.isBlank()?null:ciclo);
        return Map.of("id",id,"mensaje","Perfil de estudiante creado.");
    }
    @GetMapping("/administradores") public Object administradores(HttpSession s) {
        admin(s);
        return db.queryForList("SELECT id,correo,nombre,activo,creado_en FROM admin_usuario ORDER BY creado_en");
    }
    @PostMapping("/administradores") public Object crearAdministrador(HttpSession s,@RequestBody Map<String,String>b,@RequestHeader(value="X-CSRF-Token",required=false)String t) {
        csrf(s,t); admin(s);
        String nombre=Objects.toString(b.get("nombre"),"").trim();
        String correo=Objects.toString(b.get("correo"),"").trim().toLowerCase();
        String clave=Objects.toString(b.get("contrasena"),"");
        if(nombre.isBlank()||nombre.length()>120||!correo.matches("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")||clave.length()<12||clave.getBytes(StandardCharsets.UTF_8).length>72)
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"Revisa nombre, correo y contraseña (12 a 72 bytes).");
        if(db.queryForObject("SELECT count(*) FROM admin_usuario WHERE lower(correo)=?",Integer.class,correo)>0)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"Ya existe un perfil de administrador con ese correo.");
        db.update("INSERT INTO admin_usuario(correo,nombre,contrasena_hash,activo) VALUES (?,?,?,true)",correo,nombre,passwords.encode(clave));
        return Map.of("mensaje","Perfil de administrador creado.");
    }
    @PatchMapping("/administradores/{id}/estado") public Object estadoAdministrador(HttpSession s,@PathVariable long id,@RequestBody Map<String,Object>b,@RequestHeader(value="X-CSRF-Token",required=false)String t) {
        csrf(s,t); String current=admin(s);
        int n=db.update("UPDATE admin_usuario SET activo=? WHERE id=? AND lower(correo)<>lower(?)",Boolean.TRUE.equals(b.get("activo")),id,current);
        if(n==0) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"No se puede cambiar el estado de este perfil.");
        return Map.of("mensaje","Estado actualizado.");
    }
    @DeleteMapping("/administradores/{id}") public Object eliminarAdministrador(HttpSession s,@PathVariable long id,@RequestHeader(value="X-CSRF-Token",required=false)String t) {
        csrf(s,t); String current=admin(s);
        List<Map<String,Object>> rows=db.queryForList("SELECT correo,activo FROM admin_usuario WHERE id=?",id);
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"Perfil de administrador no encontrado.");
        String correo=Objects.toString(rows.get(0).get("correo"),"");
        if(correo.equalsIgnoreCase(current)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"No puedes eliminar el perfil con el que tienes la sesión iniciada.");
        if(Boolean.TRUE.equals(rows.get(0).get("activo"))&&db.queryForObject("SELECT count(*) FROM admin_usuario WHERE activo=true",Integer.class)<=1)
            throw new ResponseStatusException(HttpStatus.CONFLICT,"No puedes eliminar al último administrador activo.");
        db.update("DELETE FROM admin_usuario WHERE id=?",id);
        return Map.of("mensaje","Perfil de administrador eliminado.");
    }
    private LocalDate fecha(String value, LocalDate fallback) { return value==null||value.isBlank()?fallback:LocalDate.parse(value); }
    private Timestamp desde(LocalDate d) { return Timestamp.valueOf(d.atStartOfDay()); }
    private Timestamp hasta(LocalDate d) { return Timestamp.valueOf(d.plusDays(1).atStartOfDay()); }
    private LocalDate[] periodo(String d,String h) {
        LocalDate fin=fecha(h,LocalDate.now()); LocalDate ini=fecha(d,fin.withDayOfMonth(1));
        if(ini.isAfter(fin)) throw new ResponseStatusException(HttpStatus.BAD_REQUEST,"El periodo no es válido.");
        return new LocalDate[]{ini,fin};
    }
    @GetMapping("/reportes/emparejamientos") public Object emparejamientos(HttpSession s,@RequestParam(required=false)String desde,@RequestParam(required=false)String hasta) {
        admin(s); var p=periodo(desde,hasta);
        var serie=db.queryForList("SELECT date(COALESCE(respondido_en,creado_en)) dia,count(*) aceptados FROM emparejamiento WHERE estado='ACEPTADO' AND COALESCE(respondido_en,creado_en)>=? AND COALESCE(respondido_en,creado_en)<? GROUP BY date(COALESCE(respondido_en,creado_en)) ORDER BY dia",desde(p[0]),hasta(p[1]));
        var tot=db.queryForMap("SELECT (SELECT count(*) FROM emparejamiento WHERE creado_en>=? AND creado_en<?) solicitudes,(SELECT count(*) FROM emparejamiento WHERE estado='ACEPTADO' AND COALESCE(respondido_en,creado_en)>=? AND COALESCE(respondido_en,creado_en)<?) aceptados",desde(p[0]),hasta(p[1]),desde(p[0]),hasta(p[1]));
        var estados=db.queryForList("SELECT estado,count(*) cantidad FROM emparejamiento WHERE creado_en>=? AND creado_en<? GROUP BY estado ORDER BY estado",desde(p[0]),hasta(p[1]));
        return Map.of("desde",p[0],"hasta",p[1],"total",tot.get("solicitudes"),"aceptados",tot.get("aceptados"),"estados",estados,"serie",serie);
    }
    @GetMapping("/reportes/asesorias") public Object asesorias(HttpSession s,@RequestParam(required=false)String desde,@RequestParam(required=false)String hasta,@RequestParam(required=false)Long curso) {
        admin(s); var p=periodo(desde,hasta);
        String q="SELECT m.id curso_id,m.nombre curso,count(*) asesorias,coalesce(sum(se.duracion_real_min),0) minutos FROM sesion se JOIN materia m ON m.id=se.materia_id WHERE se.estado='COMPLETADA' AND se.fecha_hora>=? AND se.fecha_hora<? AND (CAST(? AS bigint) IS NULL OR m.id=?) GROUP BY m.id,m.nombre ORDER BY asesorias DESC,m.nombre";
        return Map.of("desde",p[0],"hasta",p[1],"cursos",db.queryForList("SELECT id,nombre FROM materia WHERE activo=true ORDER BY nombre"),"detalle",db.queryForList(q,desde(p[0]),hasta(p[1]),curso,curso));
    }
    @GetMapping("/reportes/satisfaccion") public Object satisfaccion(HttpSession s,@RequestParam(required=false)String desde,@RequestParam(required=false)String hasta) {
        admin(s); var p=periodo(desde,hasta);
        var rows=db.queryForList("SELECT c.estrellas,count(*) cantidad FROM calificacion c JOIN sesion se ON se.id=c.sesion_id WHERE se.estado='COMPLETADA' AND c.creada_en>=? AND c.creada_en<? GROUP BY c.estrellas ORDER BY c.estrellas",desde(p[0]),hasta(p[1]));
        Map<Integer,Long> conteos=new TreeMap<>(); for(int i=1;i<=5;i++) conteos.put(i,0L);
        for(var row:rows) conteos.put(((Number)row.get("estrellas")).intValue(),((Number)row.get("cantidad")).longValue());
        Double average=db.queryForObject("SELECT avg(c.estrellas) FROM calificacion c JOIN sesion se ON se.id=c.sesion_id WHERE se.estado='COMPLETADA' AND c.creada_en>=? AND c.creada_en<?",Double.class,desde(p[0]),hasta(p[1]));
        long total=conteos.values().stream().mapToLong(Long::longValue).sum();
        return Map.of("desde",p[0],"hasta",p[1],"total",total,"promedio",average==null?0:average,"por_estrellas",conteos);
    }
}
