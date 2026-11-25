package com.studymatch.controller;

import com.studymatch.service.SesionService;
import jakarta.servlet.http.HttpSession;
import java.sql.Timestamp;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** Recibe peticiones HTTP y delega el trabajo a los servicios. */
@RestController
@RequestMapping("/api")
public class C_Sesion {

    private final SesionService sesionService;

    public C_Sesion(SesionService sesionService) {
        this.sesionService = sesionService;
    }

    private long student(HttpSession session) {
        return (Long) session.getAttribute("studentId");
    }

    /** Devuelve las horas sin zona de PostgreSQL como horas locales explícitas de Perú/Bogotá. */
    private Object normalizeSessionDateTime(Object value) {
        if (value instanceof List<?> rows) {
            return rows.stream().map(this::normalizeSessionDateTime).toList();
        }
        if (value instanceof Map<?, ?> row) {
            Map<String, Object> normalized = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : row.entrySet()) {
                Object field = entry.getValue();
                if ("fecha_hora".equals(entry.getKey()) && field instanceof Timestamp timestamp) {
                    field = timestamp.toLocalDateTime().atOffset(ZoneOffset.ofHours(-5)).toString();
                }
                normalized.put(String.valueOf(entry.getKey()), field);
            }
            return normalized;
        }
        return value;
    }

    @GetMapping("/sesiones")
    public Object sessions(HttpSession s) {
        return normalizeSessionDateTime(sesionService.sessions(student(s)));
    }

    @PostMapping("/sesiones")
    public Object propose(HttpSession s, @RequestBody Map<String, Object> input) {
        return Map.of("id", sesionService.propose(student(s), input));
    }

    @PostMapping("/sesiones/{id}/{action}")
    public Object action(
        HttpSession s,
        @PathVariable long id,
        @PathVariable String action,
        @RequestBody(required = false) Map<String, Object> input
    ) {
        return normalizeSessionDateTime(sesionService.sessionAction(
            student(s),
            id,
            action,
            input == null ? Map.of() : input
        ));
    }

    @PostMapping("/sesiones/{id}/calificacion")
    public Object rate(
        HttpSession s,
        @PathVariable long id,
        @RequestBody Map<String, Object> input
    ) {
        return sesionService.rate(student(s), id, input);
    }
}
