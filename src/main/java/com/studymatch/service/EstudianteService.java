package com.studymatch.service;

import static com.studymatch.service.Validaciones.id;
import static com.studymatch.service.Validaciones.required;
import static com.studymatch.service.Validaciones.text;
import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.TOO_MANY_REQUESTS;
import static org.springframework.http.HttpStatus.UNAUTHORIZED;

import com.studymatch.dao.CatalogoDAO;
import com.studymatch.dao.DisponibilidadDAO;
import com.studymatch.dao.EstudianteDAO;
import com.studymatch.dao.MateriaDAO;
import com.studymatch.dao.SesionDAO;
import com.studymatch.dao.SuscripcionDAO;
import com.studymatch.model.Registro;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

/** Gestiona el registro, el inicio de sesión y los cambios del perfil. */
@Service
public class EstudianteService {

    private static final int MAX_LOGIN_ATTEMPTS = 3;
    private static final long LOCK_DURATION_MS = 5 * 60 * 1000L;

    private record LoginAttemptState(int failures, long lockedUntil) {}

    private final CatalogoDAO catalogoDAO;
    private final DisponibilidadDAO disponibilidadDAO;
    private final EstudianteDAO estudianteDAO;
    private final MateriaDAO materiaDAO;
    private final SuscripcionDAO suscripcionDAO;
    private final SesionDAO sesionDAO;
    private final BCryptPasswordEncoder passwords = new BCryptPasswordEncoder(12);
    private final ConcurrentHashMap<String, LoginAttemptState> loginAttempts = new ConcurrentHashMap<>();

    public EstudianteService(
        CatalogoDAO catalogoDAO,
        DisponibilidadDAO disponibilidadDAO,
        EstudianteDAO estudianteDAO,
        MateriaDAO materiaDAO,
        SuscripcionDAO suscripcionDAO,
        SesionDAO sesionDAO
    ) {
        this.catalogoDAO = catalogoDAO;
        this.disponibilidadDAO = disponibilidadDAO;
        this.estudianteDAO = estudianteDAO;
        this.materiaDAO = materiaDAO;
        this.suscripcionDAO = suscripcionDAO;
        this.sesionDAO = sesionDAO;
    }

    /** Comprueba los límites de longitud admitidos para la contraseña. */
    private void password(String value) {
        if (
            value == null ||
            value.length() < 8 ||
            value.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > 72
        ) throw new ResponseStatusException(
            BAD_REQUEST,
            "La contraseña debe tener al menos 8 caracteres y no superar 72 bytes."
        );
    }

    /** Comprueba que la opción exista y esté disponible en el catálogo. */
    private String catalogChoice(String catalog, String value, String previous) {
        int max = catalog.equals("carrera") ? 100 : 20;
        String name = required(value, catalog, max);
        if (
            catalog.equals("ciclo") && !name.matches("Ciclo ([1-9]|10)")
        ) throw new ResponseStatusException(BAD_REQUEST, "Selecciona un ciclo del 1 al 10.");
        var rows = catalogoDAO.buscarOpcion(catalog, name);
        if (
            rows.isEmpty() ||
            (!Boolean.TRUE.equals(rows.get(0).get("activo")) && !name.equals(previous))
        ) throw new ResponseStatusException(
            BAD_REQUEST,
            "Selecciona una opción disponible de " + catalog + "."
        );
        return name;
    }

    /** Valida los datos y crea al estudiante con una suscripción gratuita. */
    @Transactional
    public Map<String, Object> register(Registro r) {
        String email = required(r.correo(), "correo", 120).toLowerCase(Locale.ROOT);
        if (!email.matches("^[^\\s@]+@utp\\.edu\\.pe$")) throw new ResponseStatusException(
            BAD_REQUEST,
            "Usa tu correo institucional terminado en @utp.edu.pe."
        );
        password(r.contrasena());
        String career = catalogChoice("carrera", r.carrera(), null);
        String cycle = catalogChoice("ciclo", r.ciclo(), null);
        long student = estudianteDAO.crear(
            email,
            passwords.encode(r.contrasena()),
            required(r.nombre(), "nombre", 100),
            career,
            cycle
        );
        suscripcionDAO.crearGratuita(student);
        return estudianteDAO.perfil(student);
    }

    /** Comprueba el correo y la contraseña, bloqueando 5 minutos tras 3 intentos fallidos. */
    public Map<String, Object> login(Map<String, String> input) {
        String email = text(input, "correo", 120).toLowerCase(Locale.ROOT);
        long now = System.currentTimeMillis();

        LoginAttemptState state = loginAttempts.get(email);
        if (state != null && state.lockedUntil() > now) {
            long remainingSeconds = (state.lockedUntil() - now + 999) / 1000;
            long mins = remainingSeconds / 60;
            long secs = remainingSeconds % 60;
            String waitMsg = mins > 0
                ? String.format(Locale.ROOT, "%d min %02d seg", mins, secs)
                : secs + " segundos";
            throw new ResponseStatusException(
                TOO_MANY_REQUESTS,
                "Demasiados intentos fallidos. Intenta de nuevo en " + waitMsg + "."
            );
        }

        String raw = input.get("contrasena");
        var rows = estudianteDAO.credenciales(email);
        if (
            raw == null ||
            rows.isEmpty() ||
            !passwords.matches(raw, String.valueOf(rows.get(0).get("contrasena_hash")))
        ) {
            int currentFailures = (state != null && state.lockedUntil() <= now)
                ? state.failures() + 1
                : 1;
            if (currentFailures >= MAX_LOGIN_ATTEMPTS) {
                loginAttempts.put(email, new LoginAttemptState(currentFailures, now + LOCK_DURATION_MS));
                throw new ResponseStatusException(
                    TOO_MANY_REQUESTS,
                    "Has superado los 3 intentos fallidos. Tu inicio de sesión está bloqueado por 5 minutos."
                );
            }
            loginAttempts.put(email, new LoginAttemptState(currentFailures, 0L));
            int remaining = MAX_LOGIN_ATTEMPTS - currentFailures;
            throw new ResponseStatusException(
                UNAUTHORIZED,
                "Correo o contraseña incorrectos. Te quedan " + remaining +
                    (remaining == 1 ? " intento." : " intentos.")
            );
        }

        loginAttempts.remove(email);
        return estudianteDAO.perfil(((Number) id(rows.get(0), "id")).longValue());
    }

    /** Actualiza el perfil después de validar la carrera y el ciclo. */
    @Transactional
    public Map<String, Object> updateProfile(long student, Map<String, Object> input) {
        var current = estudianteDAO.perfil(student);
        String career = catalogChoice(
            "carrera",
            text(input, "carrera", 100),
            (String) current.get("carrera")
        );
        String cycle = catalogChoice(
            "ciclo",
            text(input, "ciclo", 20),
            (String) current.get("ciclo")
        );
        estudianteDAO.actualizarPerfil(
            text(input, "nombre", 100),
            career,
            cycle,
            (String) Objects.toString(input.get("bio"), "").substring(
                0,
                Math.min(Objects.toString(input.get("bio"), "").length(), 2000)
            ),
            Boolean.TRUE.equals(input.get("push_activo")),
            student
        );
        return estudianteDAO.perfil(student);
    }

    /** Comprueba la clave actual antes de guardar la nueva con BCrypt. */
    public void changePassword(long student, Map<String, String> input) {
        var stored = estudianteDAO.claveGuardada(student);
        if (
            !passwords.matches(
                Objects.toString(input.get("actual"), ""),
                stored.get("contrasena_hash").toString()
            )
        ) throw new ResponseStatusException(BAD_REQUEST, "La contraseña actual no coincide.");
        password(input.get("nueva"));
        estudianteDAO.cambiarClave((String) passwords.encode(input.get("nueva")), student);
    }

    /** Valida la contraseña actual antes de desactivar la cuenta definitivamente. */
    @Transactional
    public Object delete(long student, String contrasenaActual) {
        if (contrasenaActual == null || contrasenaActual.isBlank()) {
            throw new ResponseStatusException(
                BAD_REQUEST,
                "Ingresa tu contraseña actual para confirmar la eliminación de tu cuenta."
            );
        }
        var stored = estudianteDAO.claveGuardada(student);
        if (
            stored == null ||
            !passwords.matches(contrasenaActual, String.valueOf(stored.get("contrasena_hash")))
        ) {
            throw new ResponseStatusException(
                UNAUTHORIZED,
                "La contraseña ingresada no es correcta."
            );
        }

        boolean pendientes = sesionDAO.listarDelEstudiante(student).stream()
            .anyMatch(sesion -> "CONFIRMADA".equals(sesion.get("estado"))
                && sesion.get("fecha_hora") instanceof java.sql.Timestamp fecha
                && fecha.toLocalDateTime().isAfter(java.time.LocalDateTime.now()));
        if (pendientes) throw new ResponseStatusException(
            org.springframework.http.HttpStatus.CONFLICT,
            "Tienes sesiones confirmadas pendientes. Cancélalas antes de eliminar tu cuenta");
        estudianteDAO.desactivar(student);

        return Map.of("mensaje", "Cuenta desactivada.");
    }

    public Object other(long id) {
        return Map.of(
            "perfil",
            estudianteDAO.perfilPublico(id),
            "materias",
            materiaDAO.listarPublicas(id),
            "horario",
            disponibilidadDAO.listarPublica(id)
        );
    }

    /** Obtiene los datos públicos de la cuenta, sin incluir su contraseña. */
    public Map<String, Object> perfil(long estudianteId) {
        return estudianteDAO.perfil(estudianteId);
    }
}