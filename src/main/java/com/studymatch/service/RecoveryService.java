package com.studymatch.service;

import static org.springframework.http.HttpStatus.BAD_REQUEST;
import static org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.studymatch.dao.EstudianteDAO;
import com.studymatch.dao.TokenDAO;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.MailSendException;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

/** Gestiona la recuperación de contraseña y el envío de correos. */
@Service
public class RecoveryService {

    private final EstudianteDAO estudianteDAO;
    private final TokenDAO tokenDAO;

    @Value("${BREVO_API_KEY:}")
    private String brevoApiKey;

    @Value("${MAIL_FROM:}")
    private String from;

    @Value("${APP_URL:http://localhost:8080}")
    private String appUrl;

    private final TemplateEngine templates;
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final HttpClient httpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .build();

    public RecoveryService(
        EstudianteDAO estudianteDAO,
        TokenDAO tokenDAO,
        TemplateEngine templates
    ) {
        this.estudianteDAO = estudianteDAO;
        this.tokenDAO = tokenDAO;
        this.templates = templates;
    }

    private String hash(String token) {
        try {
            return HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(token.getBytes(StandardCharsets.UTF_8))
            );
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException(e);
        }
    }

    /** Crea un enlace temporal para recuperar la contraseña de una cuenta existente. */
    @Transactional
    public void request(String email) {
        if (brevoApiKey.isBlank() || from.isBlank()) throw new ResponseStatusException(
            SERVICE_UNAVAILABLE,
            "La recuperación de contraseña todavía no está habilitada."
        );
        email = com.studymatch.service.Validaciones.required(email, "correo", 120).toLowerCase(
            Locale.ROOT
        );
        var rows = estudianteDAO.buscarPorCorreo(email);
        if (rows.isEmpty()) return;
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        String token = HexFormat.of().formatHex(bytes);
        Object student = rows.get(0).get("id");
        tokenDAO.invalidarRecuperacion(((Number) student).longValue());
        tokenDAO.crearRecuperacion(((Number) student).longValue(), hash(token));
        sendMail(
            email,
            "Restablecer tu contraseña de StudyMatch",
            "Para crear una nueva contraseña, abre este enlace (válido durante 30 minutos):\n" +
                appUrl +
                "/?reset=" +
                token,
            renderMail(
                "Restablece tu contraseña",
                "Recibimos una solicitud para cambiar la contraseña de tu cuenta. Usa el siguiente botón para crear una nueva.",
                null,
                appUrl + "/?reset=" + token,
                30
            )
        );
    }

    /** Sends a time-limited password reset link for an administrator account. */
    public void sendAdminRecovery(String email, String resetUrl) {
        sendMail(
            email,
            "Restablecer tu contraseña de StudyMatch Admin",
            "Para crear una nueva contraseña, abre este enlace (válido durante 30 minutos):\n" + resetUrl,
            renderMail(
                "Restablece tu contraseña",
                "Recibimos una solicitud para cambiar la contraseña de tu cuenta administrativa. Usa el siguiente botón para crear una nueva.",
                null,
                resetUrl,
                30
            )
        );
    }

    public void sendVerificationCode(String email, String code) {
        sendMail(
            email,
            "Verifica tu correo de StudyMatch",
            "Tu código de verificación es: " +
                code +
                "\nVence en 10 minutos. Si no solicitaste este registro, ignora este mensaje.",
            renderMail(
                "Verifica tu correo",
                "Confirma tu correo institucional para empezar a aprender y compartir. Ingresa este código en StudyMatch:",
                code,
                null,
                10
            )
        );
    }

    private String renderMail(
        String title,
        String description,
        String code,
        String actionUrl,
        int minutes
    ) {
        var context = new Context(new Locale("es"));
        context.setVariable("title", title);
        context.setVariable("description", description);
        context.setVariable("code", code);
        context.setVariable("actionUrl", actionUrl);
        context.setVariable("minutes", minutes);
        String html = templates.process("email", context);
        return embedLogo(html);
    }

    private String embedLogo(String html) {
        try {
            var resource = new ClassPathResource("static/images/studymatch-logo.png");
            if (resource.exists()) {
                String base64 = Base64.getEncoder().encodeToString(resource.getContentAsByteArray());
                return html.replace(
                    "cid:studymatch-logo",
                    "data:image/png;base64," + base64
                );
            }
        } catch (IOException ignored) {
        }
        return html;
    }

    private void sendMail(String email, String subject, String body, String html) {
        if (brevoApiKey.isBlank() || from.isBlank()) throw new ResponseStatusException(
            SERVICE_UNAVAILABLE,
            "Falta configurar el envío de correo. Intenta de nuevo cuando el administrador lo habilite."
        );
        try {
            var payload = Map.of(
                "sender", Map.of("name", "StudyMatch", "email", from.trim()),
                "to", List.of(Map.of("email", email.trim())),
                "subject", subject,
                "htmlContent", html,
                "textContent", body
            );
            String json = objectMapper.writeValueAsString(payload);
            var request = HttpRequest.newBuilder()
                .uri(URI.create("https://api.brevo.com/v3/smtp/email"))
                .timeout(Duration.ofSeconds(15))
                .header("accept", "application/json")
                .header("content-type", "application/json")
                .header("api-key", brevoApiKey.trim())
                .POST(HttpRequest.BodyPublishers.ofString(json, StandardCharsets.UTF_8))
                .build();
            var response = httpClient.send(request, HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                throw new MailSendException(
                    "Error al enviar correo con Brevo (HTTP " + response.statusCode() + "): " + response.body()
                );
            }
        } catch (IOException e) {
            throw new MailSendException("No se pudo conectar con la API de Brevo.", e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new MailSendException("Envío de correo interrumpido.", e);
        }
    }

    /** Comprueba el token de recuperación antes de cambiar la contraseña. */
    @Transactional
    public void reset(String token, String raw) {
        if (
            token == null ||
            !token.matches("[a-f0-9]{64}") ||
            raw == null ||
            raw.length() < 8 ||
            raw.getBytes(StandardCharsets.UTF_8).length > 72
        ) throw new ResponseStatusException(
            BAD_REQUEST,
            "Revisa el enlace y la contraseña (mínimo 8 caracteres)."
        );
        var row = tokenDAO.buscarRecuperacionVigente(hash(token));
        estudianteDAO.cambiarClave(
            new BCryptPasswordEncoder(12).encode(raw),
            ((Number) row.get("estudiante_id")).longValue()
        );
        tokenDAO.invalidarRecuperacion(((Number) row.get("estudiante_id")).longValue());
    }

    /** Transporte de avisos del sistema. Los tests sustituyen esta frontera con un doble. */
    public void sendAviso(String correo, String titulo, String mensaje) {
        sendMail(correo, titulo, mensaje, renderMail(titulo, mensaje, null, null, 0));
    }
}
