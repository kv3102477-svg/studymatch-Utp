"use strict";

// La vista conserva el diseño. Cada lectura y escritura se realiza mediante el backend.
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) =>
    String(value ?? "").replace(
        /[&<>"']/g,
        (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
const initials = (name) =>
    String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((x) => x[0])
        .join("")
        .toUpperCase();
const setText = (id, value) => {
    if ($(id)) $(id).textContent = value ?? "—";
};
const show = (id, visible, display = "block") => {
    if ($(id)) $(id).style.display = visible ? display : "none";
};

function repairMojibake(value) {
    const raw = String(value ?? "");
    if (!/[ÃÂâð]/.test(raw)) return raw;
    try {
        const bytes = new Uint8Array([...raw].map((ch) => ch.charCodeAt(0) & 0xff));
        const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        return decoded && !decoded.includes("\ufffd") ? decoded : raw;
    } catch {
        return raw;
    }
}

const dateText = (value) =>
    value
        ? new Date(value).toLocaleString("es-PE", {
              timeZone: "America/Bogota",
              dateStyle: "medium",
              timeStyle: "short",
              hour12: false,
          })
        : "—";
const buildPeruSessionDateTime = (date, time) => {
    const cleanDate = String(date || "").trim();
    const cleanTime = String(time || "").trim();
    const withSeconds = /^\d{2}:\d{2}$/.test(cleanTime) ? `${cleanTime}:00` : cleanTime;
    return `${cleanDate}T${withSeconds}-05:00`;
};
const empty = (text) =>
    `<div style="padding:24px;text-align:center;color:var(--text-muted);grid-column:1/-1;">${escapeHtml(repairMojibake(text))}</div>`;

const MIN_RESCHEDULE_ADVANCE_HOURS = 6;
const SCHEDULE_MIN_MINUTES = 6 * 60;
const SCHEDULE_MAX_MINUTES = 22 * 60;
const MEETING_OPEN_LEAD_MS = 30 * 60 * 1000;

function formatMinutes24h(totalMinutes) {
    const clamped = Math.max(0, Math.min(24 * 60, Number(totalMinutes) || 0));
    const hh = Math.floor(clamped / 60);
    const mm = clamped % 60;
    return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function formatLocalDateInput(dateObj) {
    const d = dateObj instanceof Date ? dateObj : new Date(dateObj);
    return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
    ].join("-");
}

function canRescheduleSession(session) {
    if (!session || !["PROPUESTA", "CONFIRMADA"].includes(session.estado)) return false;
    const startMs = new Date(session.fecha_hora).getTime();
    if (Number.isNaN(startMs)) return true;
    const minAdvanceMs = MIN_RESCHEDULE_ADVANCE_HOURS * 60 * 60 * 1000;
    return startMs - Date.now() >= minAdvanceMs;
}

function getMeetingWindowStatus(session) {
    const startMs = new Date(session?.fecha_hora).getTime();
    if (Number.isNaN(startMs)) {
        return { canJoin: true };
    }
    const openAtMs = startMs - MEETING_OPEN_LEAD_MS;
    return {
        canJoin: session?.estado === "EN_CURSO" || Date.now() >= openAtMs,
    };
}

function syncSessionAdvanceLabels() {
    const dateLabel =
        $("sesion-fecha")?.closest(".form-group, .field-group, div")?.querySelector("label") ||
        document.querySelector('label[for="sesion-fecha"]');
    if (dateLabel && /anticipaci/i.test(dateLabel.textContent || "")) {
        dateLabel.textContent = reschedulingSessionId
            ? "Fecha (Hasta 6h antes)"
            : "Fecha";
    }
    const timeLabel =
        $("sesion-hora")?.closest(".form-group, .field-group, div")?.querySelector("label") ||
        document.querySelector('label[for="sesion-hora"]');
    if (timeLabel && !/\(24h\)/i.test(timeLabel.textContent || "")) {
        timeLabel.textContent = `${(timeLabel.textContent || "Hora").trim()} (24h)`;
    }
}

function hideDocumentsTab() {
    document
        .querySelectorAll(
            '#tab-informacion .sub-tabs-container .tab[data-target*="doc"], #tab-informacion .sub-tabs-container .tab[data-target*="documento"], #tab-informacion > .tab-content[id*="doc"], #tab-informacion > .tab-content[id*="documento"], #upload-drop-area, #upload-confirm-area, #uploaded-files-list, [id*="documentos"]',
        )
        .forEach((el) => {
            if (el.id === "uploaded-files-list") return;
            const text = (el.textContent || "").trim();
            if (
                el.matches('[data-target*="doc"], [data-target*="documento"], [id*="doc"], [id*="documento"], #upload-drop-area, #upload-confirm-area') ||
                /^documentos$/i.test(text)
            ) {
                el.style.setProperty("display", "none", "important");
                el.setAttribute("hidden", "true");
            }
        });
    document.querySelectorAll("#tab-informacion .sub-tabs-container .tab").forEach((tab) => {
        if (/documento/i.test(tab.textContent || "")) {
            tab.style.setProperty("display", "none", "important");
            tab.setAttribute("hidden", "true");
        }
    });
}

function createReferenceId() {
    try {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
            return crypto.randomUUID();
        }
    } catch {}
    try {
        if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
            const bytes = new Uint8Array(16);
            crypto.getRandomValues(bytes);
            bytes[6] = (bytes[6] & 0x0f) | 0x40;
            bytes[8] = (bytes[8] & 0x3f) | 0x80;
            const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
            return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
        }
    } catch {}
    return `ref-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function showPopoverSafe(menu) {
    if (!menu) return;
    if (typeof menu.showPopover === "function") {
        try {
            menu.showPopover();
            return;
        } catch {}
    }
    menu.style.display = "block";
}

function hidePopoverSafe(menu) {
    if (!menu) return;
    if (typeof menu.hidePopover === "function") {
        try {
            menu.hidePopover();
        } catch {}
    }
    menu.style.display = "none";
}

let csrf = "",
    currentUser = null,
    mySubjects = [],
    sessions = [],
    badges = [],
    conversations = [],
    subscriptions = [],
    plans = [];
let selectedStudent = null,
    selectedConversation = null,
    selectedRating = null,
    selectedStars = 0,
    selectedCancellation = null,
    pastSessions = false;
let reschedulingSessionId = null,
    reschedulingSessionRow = null;
let savedSchedule = [],
    selectedSlots = new Set(),
    poll = null,
    pollSessionsBusy = false,
    statusTimer = null;

// Control de cierre de sesión automático por inactividad (10 minutos = 600,000 ms)
const INACTIVITY_LIMIT_MS = 10 * 60 * 1000;
let inactivityTimer = null;
let inactivityEventsBound = false;

function stopInactivityWatch() {
    clearTimeout(inactivityTimer);
    inactivityTimer = null;
}

async function handleInactivityLogout() {
    if (!currentUser) return;
    stopInactivityWatch();
    try {
        await api("/auth/logout", "POST");
    } catch {}
    loggedOut();
    try {
        await token();
    } catch {}
    notify("Tu sesión se cerró automáticamente por 10 minutos de inactividad.", true);
}

function resetInactivityTimer() {
    if (!currentUser) return;
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(() => {
        handleInactivityLogout();
    }, INACTIVITY_LIMIT_MS);
}

function startInactivityWatch() {
    if (!inactivityEventsBound) {
        inactivityEventsBound = true;
        for (const evt of ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "click"]) {
            document.addEventListener(evt, resetInactivityTimer, { passive: true });
        }
    }
    resetInactivityTimer();
}

function closeTopbarProfileMenu() {
    const dropdown = $("topbar-profile-dropdown");
    const avatar = $("topbar-user-avatar");
    if (dropdown) dropdown.style.display = "none";
    if (avatar) avatar.setAttribute("aria-expanded", "false");
}

function formatExpirationDate(dateObj) {
    if (!dateObj || Number.isNaN(dateObj.getTime())) return "Sin vencimiento";
    return dateObj.toLocaleDateString("es-PE", {
        timeZone: "America/Bogota",
        dateStyle: "long",
    });
}

function addMonthsSafe(dateObj, months) {
    const d = new Date(dateObj.getTime());
    d.setMonth(d.getMonth() + months);
    return d;
}

function addWeeksSafe(dateObj, weeks) {
    const d = new Date(dateObj.getTime());
    d.setDate(d.getDate() + weeks * 7);
    return d;
}

// Último lunes de marzo del año indicado
function utpMarchCycleStart(year) {
    const d = new Date(year, 2, 31, 23, 59, 59);
    const offsetToMonday = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offsetToMonday);
    return d;
}

// Segundo lunes de agosto del año indicado
function utpAugustCycleStart(year) {
    const firstAug = new Date(year, 7, 1, 23, 59, 59);
    const daysToFirstMonday = (8 - firstAug.getDay()) % 7;
    const secondMonday = 1 + daysToFirstMonday + 7;
    return new Date(year, 7, secondMonday, 23, 59, 59);
}

// Cierre de 18 semanas según el ciclo UTP (marzo o agosto)
function utpSemesterExpiration(fromDate = new Date()) {
    const base = new Date(fromDate);
    if (Number.isNaN(base.getTime())) return null;
    const year = base.getFullYear();

    const marchEnd = addWeeksSafe(utpMarchCycleStart(year), 18);
    const augEnd = addWeeksSafe(utpAugustCycleStart(year), 18);

    if (base <= marchEnd) return marchEnd;
    if (base <= augEnd) return augEnd;
    return addWeeksSafe(utpMarchCycleStart(year + 1), 18);
}

function parseServerDate(raw) {
    if (!raw) return null;
    const str = String(raw).trim();
    const normalized = str.length === 10 ? `${str}T23:59:59-05:00` : str;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? null : d;
}

function computePlanExpiration(sub, user) {
    const explicit = parseServerDate(sub?.fecha_vencimiento);
    if (explicit) return explicit;

    const baseDate =
        parseServerDate(sub?.fecha_inicio) ||
        parseServerDate(user?.creado_en) ||
        parseServerDate(user?.fecha_registro) ||
        new Date();

    const isPaidActive = Boolean(sub && ["ACTIVO", "TRIAL"].includes(sub.estado_actual));
    if (isPaidActive) {
        const label = `${sub.periodo || ""} ${sub.plan || ""}`;
        if (/semestr|ciclo/i.test(label)) {
            return utpSemesterExpiration(baseDate);
        }
        return addMonthsSafe(baseDate, 1);
    }

    // Plan gratuito inicial: 2 meses gratis
    return addMonthsSafe(baseDate, 2);
}

let catalogRequest = 0;
async function loadCatalogs() {
    const request = ++catalogRequest;
    const ids = ["reg-career", "perfil-carrera", "reg-cycle", "perfil-ciclo"];
    const selected = Object.fromEntries(ids.map((id) => [id, $(id).value]));
    for (const id of ids) {
        $(id).replaceChildren(new Option("Cargando opciones…", ""));
        $(id).disabled = true;
    }
    $("btn-register").disabled = true;
    $("btn-save-profile").disabled = true;
    $("filter-career").replaceChildren(new Option("Todas las carreras", "Todos"));
    try {
        const catalogs = await api("/auth/catalogos");
        if (request !== catalogRequest) return;
        for (const [id, rows, label] of [
            ["reg-career", catalogs.carreras, "carreras"],
            ["perfil-carrera", catalogs.carreras, "carreras"],
            ["reg-cycle", catalogs.ciclos, "ciclos"],
            ["perfil-ciclo", catalogs.ciclos, "ciclos"],
        ]) {
            const select = $(id);
            select.replaceChildren(
                new Option(rows.length ? "Selecciona…" : `No hay ${label} registradas`, ""),
            );
            for (const row of rows) select.add(new Option(row.nombre, row.nombre));
            if (rows.some((row) => row.nombre === selected[id])) select.value = selected[id];
            select.disabled = !rows.length;
        }
        const unavailable = !catalogs.carreras.length || !catalogs.ciclos.length;
        $("btn-register").disabled = unavailable;
        $("btn-save-profile").disabled = unavailable;
        for (const row of catalogs.carreras)
            $("filter-career").add(new Option(row.nombre, row.nombre));
    } catch (error) {
        if (request !== catalogRequest) return;
        for (const id of ids)
            $(id).replaceChildren(new Option("No se pudo cargar el catálogo", ""));
        throw error;
    }
}

function notify(text, error = false) {
    const box = $("live-status");
    box.textContent = repairMojibake(text);
    box.style.background = error ? "#8e1230" : "#161616";
    box.style.display = "block";
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (box.style.display = "none"), 7000);
}
window.showToast = (text, type) => notify(text, type === "error");
async function api(path, method = "GET", data) {
    const headers = {};
    const options = { method, headers, credentials: "same-origin", cache: "no-store" };
    if (method !== "GET") headers["X-CSRF-Token"] = csrf;
    if (data instanceof FormData) options.body = data;
    else if (data !== undefined) {
        headers["Content-Type"] = "application/json";
        options.body = JSON.stringify(data);
    }
    const response = await fetch("/api" + path, options);
    const result = await response
        .json()
        .catch(() => ({ error: "No se pudo interpretar la respuesta del servidor." }));
    if (!response.ok) {
        if (response.status === 401 && currentUser) {
            loggedOut();
            await token();
        }
        throw new Error(repairMojibake(result.error || result.message || "No se pudo completar la operación."));
    }
    return result;
}
const handle = (fn) => async (event) => {
    if (event?.currentTarget !== document) event?.preventDefault();
    const button = event?.currentTarget;
    if (button?.disabled) return;
    if (button?.tagName === "BUTTON") button.disabled = true;
    try {
        await fn(event);
    } catch (error) {
        notify(error.message, true);
    } finally {
        if (button?.tagName === "BUTTON" && !button.hasAttribute("data-managed-disabled"))
            button.disabled = false;
    }
};
const on = (id, fn, event = "click") => {
    if ($(id)) $(id).addEventListener(event, handle(fn));
};
// Enter ejecuta el mismo botón del formulario; los selectores y textos largos conservan su teclado.
function setupEnterActions() {
    const actions = {
        "login-email": "btn-login",
        "login-password": "btn-login",
        "reg-name": "btn-register",
        "reg-email": "btn-register",
        "reg-password": "btn-register",
        "recover-email": "btn-recover",
        "reset-password": "btn-reset",
        "verify-code": "btn-verify",
        "perfil-nombre": "btn-save-profile",
        "teach-subject": "btn-add-teach",
        "learn-subject": "btn-add-learn",
        "chat-input-mensaje": "btn-chat-enviar",
    };
    for (const [id, action] of Object.entries(actions))
        $(id)?.addEventListener("keydown", (event) => {
            if (
                event.key !== "Enter" ||
                event.isComposing ||
                event.repeat ||
                event.shiftKey ||
                event.ctrlKey ||
                event.altKey ||
                event.metaKey
            )
                return;
            event.preventDefault();
            const button = $(action);
            if (button && !button.disabled && button.getClientRects().length) button.click();
        });
}
let dialogResolve = null,
    dialogIsLink = false,
    dialogFocus = null;
function closeDialogSafe(dialog) {
    if (!dialog) return;
    if (typeof dialog.close === "function") {
        try {
            if (dialog.open) {
                dialog.close();
                return;
            }
        } catch {}
    }
    dialog.removeAttribute("open");
    dialog.style.display = "none";
    dialog.dispatchEvent(new Event("close"));
}
function appDialog({ title, description, link = false, value = "", confirm = "Confirmar" }) {
    if (dialogResolve) return Promise.resolve(null);
    dialogIsLink = link;
    dialogFocus = document.activeElement;
    setText("app-dialog-title", title);
    setText("app-dialog-description", description);
    setText("app-dialog-submit", confirm);
    $("app-dialog-icon").className = link ? "fa-solid fa-link" : "fa-solid fa-circle-question";
    $("app-dialog-field").hidden = !link;
    $("app-dialog-input").value = value;
    setText("app-dialog-error", "");
    return new Promise((resolve) => {
        const dialog = $("app-dialog");
        dialogResolve = resolve;
        if (typeof dialog.showModal === "function") {
            try {
                dialog.showModal();
            } catch {
                dialog.setAttribute("open", "");
                dialog.style.display = "block";
            }
        } else {
            dialog.setAttribute("open", "");
            dialog.style.display = "block";
        }
        (link ? $("app-dialog-input") : $("app-dialog-cancel")).focus();
    });
}
function setupAppDialog() {
    const dialog = $("app-dialog");
    if (!dialog) return;
    for (const id of ["app-dialog-close", "app-dialog-cancel"])
        $(id)?.addEventListener("click", () => closeDialogSafe(dialog));
    dialog.addEventListener("close", () => {
        dialog.style.display = "none";
        const resolve = dialogResolve;
        dialogResolve = null;
        resolve?.(null);
        if (dialogFocus?.isConnected) dialogFocus.focus();
    });
    $("app-dialog-form")?.addEventListener("submit", (event) => {
        event.preventDefault();
        let value = true;
        if (dialogIsLink) {
            value = $("app-dialog-input").value.trim();
            try {
                const url = new URL(value);
                if (url.protocol !== "https:" || !url.hostname || url.username || url.password)
                    throw new Error();
            } catch {
                setText("app-dialog-error", "Pega un enlace válido que empiece por https://.");
                $("app-dialog-input").focus();
                return;
            }
        }
        const resolve = dialogResolve;
        dialogResolve = null;
        closeDialogSafe(dialog);
        resolve?.(value);
    });
}
function authPage(id) {
    if (id !== "verify-section") {
        ++verificationRequest;
        clearInterval(verificationTimer);
    }
    document
        .querySelectorAll("#auth-wrapper .auth-box")
        .forEach((e) => (e.style.display = e.id === id ? "block" : "none"));
}
async function token() {
    csrf = (await api("/auth/csrf")).token;
}
function loggedOut() {
    stopInactivityWatch();
    closeTopbarProfileMenu();
    clearInterval(poll);
    pollSessionsBusy = false;
    currentUser = null;
    mySubjects = [];
    sessions = [];
    badges = [];
    conversations = [];
    subscriptions = [];
    plans = [];
    selectedStudent = null;
    selectedConversation = null;
    selectedRating = null;
    reschedulingSessionId = null;
    reschedulingSessionRow = null;
    savedSchedule = [];
    selectedSlots.clear();
    document
        .querySelectorAll('[id^="modal-"],#rf38-modal-popup-vencimiento,#rf46-toast-msg')
        .forEach((e) => (e.style.display = "none"));
    show("app-container", false);
    show("auth-wrapper", true, "flex");
    authPage("login-section");
}
function profile() {
    if (!currentUser) return;
    const u = currentUser;
    setText("sidebar-name", u.nombre);
    setText("sidebar-subtitle", [u.ciclo, u.carrera].filter(Boolean).join(" · "));
    setText("card-nombre", u.nombre);
    setText("card-carrera", u.carrera);
    setText("card-ciclo", u.ciclo);
    setText("summary-nombre", u.nombre);
    setText("summary-carrera", u.carrera);
    setText("summary-ciclo", u.ciclo);
    setText("dash-greeting", `Hola de nuevo, ${u.nombre.split(" ")[0]}`);
    for (const id of ["sidebar-avatar", "card-avatar", "form-avatar", "topbar-user-avatar"]) {
        const e = $(id);
        if (!e) continue;
        e.textContent = initials(u.nombre);
        if (u.foto_url) {
            const image = document.createElement("img");
            image.src = "/api/perfil/foto?v=" + Date.now();
            image.alt = "Tu foto de perfil";
            image.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:inherit;";
            e.replaceChildren(image);
        }
    }
    show("btn-remove-photo", Boolean(u.foto_url), "inline-flex");
    $("perfil-nombre").value = u.nombre || "";
    $("perfil-bio").value = u.bio || "";
    for (const [id, value] of [
        ["perfil-carrera", u.carrera],
        ["perfil-ciclo", u.ciclo],
    ]) {
        const el = $(id);
        el.value = Array.from(el.options).some((o) => o.value === value) ? value : "";
    }
    hideDocumentsTab();
}
let verificationRequest = 0,
    verificationTimer = null,
    verificationEmail = "";
function verificationDelivery(sent, seconds = 0, failed = false) {
    const button = $("btn-resend-code");
    clearInterval(verificationTimer);
    button.dataset.label = failed ? "Volver a intentar" : "Reenviar código";
    $("btn-verify").disabled = !sent;
    const deadline = Date.now() + Number(seconds) * 1000;
    const update = () => {
        const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        button.disabled = remaining > 0;
        button.textContent = button.dataset.label + (remaining ? " (" + remaining + " s)" : "");
        if (!remaining) clearInterval(verificationTimer);
    };
    update();
    if (seconds > 0) verificationTimer = setInterval(update, 1000);
}
async function sendVerificationEmail() {
    const request = ++verificationRequest,
        email = verificationEmail;
    clearInterval(verificationTimer);
    $("btn-resend-code").disabled = true;
    $("btn-verify").disabled = true;
    setText("verify-delivery-status", "Enviando código…");
    setText("btn-resend-code", "Enviando…");
    try {
        const result = await api("/auth/reenviar-codigo", "POST");
        if (request !== verificationRequest || email !== verificationEmail) return;
        setText("verify-description", "Ingresa el código de seis dígitos enviado a:");
        setText(
            "verify-delivery-status",
            "Código enviado. Revisa tu bandeja de entrada y la carpeta de spam.",
        );
        $("verify-code").value = "";
        verificationDelivery(true, result.reenviar_en_segundos);
        $("verify-code").focus();
    } catch (error) {
        if (request !== verificationRequest || email !== verificationEmail) return;
        let status = { codigo_enviado: false, reenviar_en_segundos: 5 };
        try {
            status = await api("/auth/verificacion");
        } catch {}
        if (request !== verificationRequest || email !== verificationEmail) return;
        setText("verify-description", "Verifica el correo de tu cuenta:");
        setText(
            "verify-delivery-status",
            "No pudimos enviar el código. " +
                (status.codigo_enviado
                    ? "Puedes usar el último que recibiste o volver a intentar."
                    : "Vuelve a intentarlo en unos segundos."),
        );
        verificationDelivery(status.codigo_enviado, status.reenviar_en_segundos, true);
    }
}
async function signedIn(result) {
    if (result.requiere_verificacion) {
        const request = ++verificationRequest;
        stopInactivityWatch();
        clearInterval(poll);
        currentUser = null;
        csrf = result.csrf;
        verificationEmail = result.correo;
        show("app-container", false);
        show("auth-wrapper", true, "flex");
        authPage("verify-section");
        setText("verify-email-display", result.correo);
        setText("verify-description", "Verifica el correo de tu cuenta:");
        $("verify-code").value = "";
        $("login-password").value = "";
        $("reg-password").value = "";
        verificationDelivery(result.codigo_enviado, result.reenviar_en_segundos);
        if (result.codigo_enviado) {
            setText("verify-delivery-status", "Código enviado. Revisa tu correo.");
            $("verify-code").focus();
        } else if (Number(result.reenviar_en_segundos) > 0) {
            setText(
                "verify-delivery-status",
                "Puedes volver a intentar el envío cuando termine la espera.",
            );
            verificationDelivery(false, result.reenviar_en_segundos, true);
        } else {
            setText("verify-delivery-status", "Enviando código…");
            $("btn-resend-code").disabled = true;
            const triggerSend = () => {
                if (request === verificationRequest) sendVerificationEmail();
            };
            if (typeof requestAnimationFrame === "function") {
                requestAnimationFrame(() => requestAnimationFrame(triggerSend));
            } else {
                setTimeout(triggerSend, 0);
            }
        }
        return;
    }
    ++verificationRequest;
    clearInterval(verificationTimer);
    currentUser = result.estudiante;
    csrf = result.csrf;
    profile();
    startInactivityWatch();
    $("login-password").value = "";
    $("reg-password").value = "";
    show("auth-wrapper", false);
    show("app-container", true, "flex");
    navigate("inicio-section", false);
    await Promise.all([refresh(), loadSearch().catch((e) => notify(e.message, true))]);

    const hasPaidSub = subscriptions.some((s) => s.estado_actual === "ACTIVO");
    if (!hasPaidSub) {
        const venceFree = $("mi-plan-fecha-vence")?.textContent;
        notify(
            venceFree && venceFree !== "Sin vencimiento"
                ? `Desde ahora cuentas con dos meses gratis (vigente hasta el ${venceFree}).`
                : "Desde ahora cuentas con dos meses gratis.",
        );
    }

    clearInterval(poll);
    pollSessionsBusy = false;
    poll = setInterval(async () => {
        if (!currentUser || document.hidden) return;
        if (document.querySelector("#chat-section.active") && selectedConversation)
            loadMessages().catch((e) => notify(e.message, true));
        loadNotifications().catch(() => {});
        if (
            !pollSessionsBusy &&
            (document.querySelector("#mis-sesiones-section.active") ||
                document.querySelector("#inicio-section.active"))
        ) {
            pollSessionsBusy = true;
            try {
                await loadSessions();
            } catch {}
            finally {
                pollSessionsBusy = false;
            }
        }
    }, 8000);
}
async function refresh() {
    const results = await Promise.allSettled([
        loadSubjects(),
        loadMySubjects(),
        loadSchedule(),
        loadSessions(),
        loadBadges(),
        loadHours(),
        loadNotifications(),
        loadSubscriptions(),
        loadConversations(),
        loadCycle(),
    ]);
    for (const result of results)
        if (result.status === "rejected") notify(result.reason.message, true);
}
async function loadCycle() {
    const rows = await api("/ciclo");
    document
        .querySelectorAll("[data-campus]")
        .forEach(
            (e) => (e.textContent = "Campus virtual" + (rows.length ? " · " + rows[0].nombre : "")),
        );
}
const normalizeText = (value) =>
    String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim()
        .toLocaleLowerCase();
const subjectSelectors = ["teach-subject", "learn-subject", "select-filtro-curso-reporte"];
const subjectRequests = {},
    subjectOptions = {};
function subjectValue(prefix) {
    const input = $(prefix + "-subject");
    const typed = normalizeText(input.value);
    const options = subjectOptions[prefix + "-subject"] || [];
    const exact = options.find((row) => normalizeText(row.nombre) === typed);
    if (exact) return exact.id;
    const matches = options.filter((row) => normalizeText(row.nombre).includes(typed));
    if (matches.length === 1) {
        input.value = matches[0].nombre;
        return matches[0].id;
    }
    throw new Error("Escribe o selecciona una materia registrada de la lista.");
}
function renderSubjectDatalist(id) {
    const input = $(id);
    const list = $(id + "-list");
    if (!input || !list) return;
    const query = normalizeText(input.value);
    const all = subjectOptions[id] || [];
    const filtered = query
        ? all.filter((row) => normalizeText(row.nombre).includes(query))
        : all;
    list.replaceChildren(...filtered.map((row) => new Option(row.nombre, row.nombre)));
}
async function loadSubjectPage(id) {
    const request = (subjectRequests[id] || 0) + 1;
    subjectRequests[id] = request;
    const input = $(id),
        isInput = input.tagName === "INPUT";
    const query = isInput ? "" : $(id + "-search")?.value || "";
    const selected = input.value;
    const result = await api("/materias?q=" + encodeURIComponent(query) + "&pagina=1");
    for (let page = 2; result.items.length < result.total; page++) {
        const next = await api("/materias?q=" + encodeURIComponent(query) + "&pagina=" + page);
        if (!next.items.length) break;
        result.items.push(...next.items);
    }
    if (subjectRequests[id] !== request) return;
    subjectOptions[id] = result.items;
    if (isInput) {
        renderSubjectDatalist(id);
    } else {
        input.replaceChildren(
            new Option("Todos los cursos", ""),
            ...result.items.map((row) => new Option(row.nombre, row.id)),
        );
        if (result.items.some((row) => String(row.id) === selected)) input.value = selected;
        input.disabled = false;
        if (id === "select-filtro-curso-reporte") reports();
    }
}
async function loadSubjects() {
    await Promise.all(subjectSelectors.map((id) => loadSubjectPage(id)));
}
function setupSubjectSearch() {
    for (const id of subjectSelectors) {
        const input = $(id).tagName === "INPUT" ? $(id) : $(id + "-search");
        if (!input) continue;
        if ($(id).tagName === "INPUT") {
            input.setAttribute("autocomplete", "off");
            input.addEventListener("input", () => {
                if (!(subjectOptions[id] || []).length) {
                    loadSubjectPage(id).catch((error) => notify(error.message, true));
                    return;
                }
                renderSubjectDatalist(id);
            });
            input.addEventListener("focus", () => {
                if (!(subjectOptions[id] || []).length) {
                    loadSubjectPage(id).catch((error) => notify(error.message, true));
                } else {
                    renderSubjectDatalist(id);
                }
            });
            continue;
        }
        let timer;
        input.addEventListener("input", () => {
            subjectRequests[id] = (subjectRequests[id] || 0) + 1;
            clearTimeout(timer);
            timer = setTimeout(
                () => loadSubjectPage(id).catch((error) => notify(error.message, true)),
                250,
            );
        });
    }
}

async function loadMySubjects() {
    mySubjects = await api("/perfil/materias");
    for (const [role, id] of [
        ["ENSENAR", "teach-tags"],
        ["APRENDER", "learn-tags"],
    ]) {
        const rows = mySubjects.filter((s) => s.tipo_rol === role);
        $(id).innerHTML = rows.length
            ? rows
                  .map(
                      (s) =>
                          `<div class="tag ${role === "ENSENAR" ? "tag-purple" : "tag-green"}">${escapeHtml(s.nombre)} <span class="level">${escapeHtml(s.nivel.toLowerCase())}</span><button type="button" class="close" data-remove-subject="${s.id}" aria-label="Quitar materia" style="border:0;background:transparent;cursor:pointer;"><i class="fa-solid fa-xmark"></i></button></div>`,
                  )
                  .join("")
            : empty("Aún no has agregado materias.");
    }
    setText("count-teach", mySubjects.filter((s) => s.tipo_rol === "ENSENAR").length);
    setText("count-learn", mySubjects.filter((s) => s.tipo_rol === "APRENDER").length);
}
function slotKey(day, hour) {
    return `${day}:${hour}`;
}
function getCurrentWeekRangeData() {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffToMonday = (today.getDay() + 6) % 7;
    const monday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - diffToMonday);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);

    const shortDays = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const days = shortDays.map((label, idx) => {
        const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + idx);
        const isToday = d.getTime() === today.getTime();
        return {
            dayNumber: idx + 1,
            label,
            dateNum: d.getDate(),
            monthName: d.toLocaleDateString("es-PE", { month: "long" }),
            isToday,
        };
    });

    const startDay = monday.getDate();
    const endDay = sunday.getDate();
    const startMonth = monday.toLocaleDateString("es-PE", { month: "long" });
    const endMonth = sunday.toLocaleDateString("es-PE", { month: "long" });
    const rangeText =
        startMonth === endMonth
            ? `Del ${startDay} al ${endDay} de ${startMonth}`
            : `Del ${startDay} de ${startMonth} al ${endDay} de ${endMonth}`;

    return { days, rangeText };
}
function drawSchedule() {
    const grid = $("schedule-grid");
    const { days, rangeText } = getCurrentWeekRangeData();

    let rangeBadge = $("schedule-week-range");
    if (!rangeBadge) {
        rangeBadge = document.createElement("div");
        rangeBadge.id = "schedule-week-range";
        rangeBadge.style.cssText =
            "font-size:13px;font-weight:600;color:var(--text-muted);margin-bottom:10px;";
        grid.parentElement?.insertBefore(rangeBadge, grid);
    }
    rangeBadge.textContent = rangeText;

    grid.innerHTML =
        '<div class="grid-header"></div>' +
        days
            .map(
                (d) =>
                    `<div class="grid-header" style="${d.isToday ? "background:var(--primary-light);color:var(--primary);font-weight:700;border-radius:6px;" : ""}">${d.label} ${d.dateNum}</div>`,
            )
            .join("");
    for (let hour = 6; hour < 23; hour++) {
        grid.insertAdjacentHTML(
            "beforeend",
            `<div class="grid-time">${String(hour).padStart(2, "0")}:00</div>`,
        );
        for (let day = 1; day <= 7; day++) {
            const isSelected = selectedSlots.has(slotKey(day, hour));
            const dayObj = days[day - 1];
            const cellBg = isSelected
                ? "background:var(--secondary-light);color:var(--secondary);"
                : dayObj?.isToday
                  ? "background:#fff8fa;"
                  : "";
            grid.insertAdjacentHTML(
                "beforeend",
                `<button type="button" class="grid-cell ${isSelected ? "selected" : ""}" data-slot="${slotKey(day, hour)}" aria-label="${dayObj?.label || "Día"} ${dayObj?.dateNum || day}, ${hour}:00" aria-pressed="${isSelected}" style="border:1px solid var(--border-color);min-height:40px;cursor:pointer;${cellBg}">${isSelected ? '<i class="fa-solid fa-check"></i>' : ""}</button>`,
            );
        }
    }
}
function resetSchedule() {
    selectedSlots = new Set();
    for (const row of savedSchedule) {
        const start = Number(String(row.hora_inicio).slice(0, 2)),
            end = Number(String(row.hora_fin).slice(0, 2));
        for (let h = start; h < end; h++) selectedSlots.add(slotKey(row.dia_semana, h));
    }
    drawSchedule();
}
async function loadSchedule() {
    savedSchedule = await api("/perfil/horario");
    resetSchedule();
    setText("count-availability", `${savedSchedule.length} franjas disponibles`);
}
async function loadHours() {
    const h = await api("/perfil/horas");
    setText("perfil-hours-teach", Number(h.horas_ensenadas).toFixed(1) + "h");
    setText("perfil-hours-learn", Number(h.horas_aprendidas).toFixed(1) + "h");
    setText("rf029-ensenadas", Number(h.horas_ensenadas).toFixed(1) + "h");
    setText("rf029-aprendidas", Number(h.horas_aprendidas).toFixed(1) + "h");
    const values = [
        Number(h.horas_ensenadas).toFixed(1) + "h",
        h.sesiones_completadas,
        "—",
        new Set(
            sessions.map((s) =>
                s.proponente_id === currentUser.id ? s.receptor_id : s.proponente_id,
            ),
        ).size,
    ];
    document
        .querySelectorAll("[data-metric]")
        .forEach((e) => (e.textContent = values[Number(e.dataset.metric)]));
    const ratings = await api("/perfil/resumen");
    document.querySelector('[data-metric="2"]').textContent =
        ratings.calificacion_promedio === null
            ? "Sin calificaciones"
            : Number(ratings.calificacion_promedio).toFixed(1);
    document.querySelector('[data-metric="3"]').textContent = ratings.companeros;
}
function isExpiredSession(s) {
    if (["COMPLETADA", "CANCELADA"].includes(s.estado)) return true;
    if (s.estado === "EN_CURSO") return false;
    const start = new Date(s.fecha_hora).getTime();
    if (Number.isNaN(start)) return false;
    const durationMs = Number(s.duracion_programada_min || 0) * 60000;
    const end = durationMs > 0 ? start + durationMs : start;
    return end < Date.now();
}
function sessionDisplayState(s) {
    if (!["COMPLETADA", "CANCELADA", "EN_CURSO"].includes(s.estado) && isExpiredSession(s)) {
        return "VENCIDA";
    }
    return s.estado;
}
async function loadSessions() {
    sessions = await api("/sesiones");
    renderSessions();
    const next = sessions
        .filter((s) => ["CONFIRMADA", "PROPUESTA", "EN_CURSO"].includes(s.estado) && !isExpiredSession(s))
        .sort((a, b) => new Date(a.fecha_hora) - new Date(b.fecha_hora))[0];
    setText("dashboard-next-subject", next ? next.materia : "Todavía no tienes sesiones");
    setText(
        "dashboard-next-detail",
        next
            ? `${dateText(next.fecha_hora)} · con ${next.companero}`
            : "Cuando agendes tu primera asesoría, aparecerá aquí.",
    );
    const nextActionBtn = $("dashboard-next-action");
    if (nextActionBtn) {
        nextActionBtn.textContent = next ? "Ver detalles" : "Buscar un mentor";
        nextActionBtn.setAttribute("data-go", next ? "mis-sesiones-section" : "buscar-section");
    }
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
    weekStart.setHours(0, 0, 0, 0);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekly = sessions.filter(
        (s) =>
            new Date(s.fecha_hora) >= weekStart &&
            new Date(s.fecha_hora) < weekEnd &&
            s.estado !== "CANCELADA",
    );
    const count = weekly.filter((s) => s.estado === "COMPLETADA").length;
    setText(
        "dashboard-week-count",
        weekly.length ? `${count} de ${weekly.length} completadas` : "Sin sesiones esta semana",
    );
    $("dashboard-week-progress").style.width =
        (weekly.length ? (count / weekly.length) * 100 : 0) + "%";
    const recent = $("dashboard-recent-sessions");
    recent.querySelectorAll(".session-item,.live-empty").forEach((e) => e.remove());
    recent.insertAdjacentHTML(
        "beforeend",
        sessions.length
            ? sessions
                  .slice(0, 3)
                  .map(
                      (s) =>
                          `<div class="session-item"><div class="session-avatar" style="background:var(--primary);">${escapeHtml(initials(s.companero))}</div><div class="session-info"><h4>${escapeHtml(s.companero)}</h4><p>${escapeHtml(s.materia)} · ${escapeHtml(dateText(s.fecha_hora))}</p></div><div class="session-status"><div class="badge badge-success">${escapeHtml(sessionDisplayState(s))}</div></div></div>`,
                  )
                  .join("")
            : '<div class="live-empty">' + empty("Todavía no tienes sesiones.") + "</div>",
    );
}
function sessionCard(s) {
    const expired = isExpiredSession(s);
    const button = (action, label) =>
        `<button class="btn btn-primary btn-mini" data-session="${s.id}" data-session-action="${action}">${label}</button>`;
    let actions = "";
    if (!expired) {
        if (s.estado === "PROPUESTA" && s.receptor_id === currentUser.id)
            actions += button("aceptar", "Aceptar");
        if (["PROPUESTA", "CONFIRMADA"].includes(s.estado)) {
            if (canRescheduleSession(s)) actions += button("reprogramar", "Reprogramar");
            actions += button("cancelar", "Cancelar") + button("enlace", "Añadir enlace");
        }
        if (
            ["CONFIRMADA", "EN_CURSO"].includes(s.estado) &&
            s.enlace_videollamada?.startsWith("https://")
        )
            actions += button("iniciar", "Iniciar reunión");
    }
    if (s.estado === "EN_CURSO")
        actions += button(
            "finalizar",
            (s.proponente_id === currentUser.id ? s.marca_proponente : s.marca_receptor)
                ? "Esperando a tu compañero"
                : "Confirmar finalización",
        );
    if (s.estado === "COMPLETADA")
        actions += button("calificar", s.estrellas ? "Actualizar calificación" : "Calificar");
    const card = $("session-card-template").content.firstElementChild.cloneNode(true);
    const fill = (name, value) => {
        card.querySelector(`[data-field="${name}"]`).textContent = value;
    };
    fill("materia", s.materia);
    fill("estado", sessionDisplayState(s));
    fill("companero", s.companero);
    fill(
        "fecha",
        new Date(s.fecha_hora).toLocaleDateString("es-PE", {
            timeZone: "America/Bogota",
            dateStyle: "full",
        }),
    );
    fill(
        "hora",
        new Date(s.fecha_hora).toLocaleTimeString("es-PE", {
            timeZone: "America/Bogota",
            timeStyle: "short",
            hour12: false,
        }),
    );
    fill(
        "duracion",
        `${s.duracion_real_min === null ? s.duracion_programada_min : s.duracion_real_min} min` +
            (s.estrellas ? ` · Tu calificación: ${s.estrellas}/5` : ""),
    );
    card.querySelector('[data-field="acciones"]').innerHTML = actions;
    return card.outerHTML;
}
function paintSessionTabs() {
    const activeTab = pastSessions ? $("tab-pasadas") : $("tab-proximas");
    const inactiveTab = pastSessions ? $("tab-proximas") : $("tab-pasadas");
    if (activeTab) {
        activeTab.classList.add("active");
        activeTab.setAttribute("aria-selected", "true");
    }
    if (inactiveTab) {
        inactiveTab.classList.remove("active");
        inactiveTab.setAttribute("aria-selected", "false");
    }
}
function sessionsEmptyHTML() {
    if (pastSessions) {
        return `<div class="sess-empty"><span class="empty-ico"><i class="fa-regular fa-calendar"></i></span><h3>Todavía no tienes sesiones pasadas</h3><p>Cuando completes tu primera asesoría, aparecerá aquí.</p><button type="button" class="btn btn-primary" data-go="buscar-section">Buscar un mentor</button></div>`;
    }
    return `<div class="sess-empty"><span class="empty-ico"><i class="fa-regular fa-calendar"></i></span><h3>Todavía no tienes sesiones próximas</h3><p>Cuando agendes tu primera asesoría, aparecerá aquí.</p><button type="button" class="btn btn-primary" data-go="buscar-section">Buscar un mentor</button></div>`;
}
function renderSessions() {
    paintSessionTabs();
    const rows = sessions.filter((s) =>
        pastSessions ? isExpiredSession(s) : !isExpiredSession(s),
    );
    $("historial-container").innerHTML = rows.length
        ? rows.map(sessionCard).join("")
        : sessionsEmptyHTML();
}
async function loadBadges() {
    badges = await api("/insignias");
    const earned = badges.filter((b) => b.obtenida_en);
    $("insignias-container").replaceChildren();
    if (!badges.length)
        $("insignias-container").innerHTML = empty("Todavía no hay insignias disponibles.");
    for (const b of badges) {
        const card = $("badge-card-template").content.firstElementChild.cloneNode(true);
        for (const [key, value] of [
            ["nombre", b.nombre],
            ["descripcion", b.descripcion || ""],
            ["horas", `${Number(b.horas_actuales).toFixed(1)} / ${b.meta_horas} hrs`],
            ["estado", b.obtenida_en ? "Obtenida el " + dateText(b.obtenida_en) : "Por obtener"],
        ])
            card.querySelector(`[data-field="${key}"]`).textContent = value;
        card.querySelector('[data-field="progreso"]').style.width =
            Math.min(100, (Number(b.horas_actuales) / Number(b.meta_horas)) * 100) + "%";
        if (!b.obtenida_en) {
            card.style.background = "white";
            card.style.border = "1px solid var(--border-color)";
            card.querySelector('[data-field="icono-fondo"]').style.background = "#94a3b8";
        }
        $("insignias-container").append(card);
    }
    $("dashboard-badges").innerHTML = earned.length
        ? earned
              .slice(0, 5)
              .map(
                  (b) =>
                      `<div class="badge-item"><div class="badge-icon" style="color:#e3a008;"><i class="fa-solid fa-award"></i></div><div class="badge-name">${escapeHtml(b.nombre)}</div></div>`,
              )
              .join("")
        : empty("Aún no has obtenido insignias.");
    setText("sidebar-badge-count", earned.length);
    $("dashboard-badge-progress").querySelector(".progress-text").textContent =
        `${earned.length} de ${badges.length} insignias obtenidas`;
    $("dashboard-badge-progress").querySelector(".progress-bar-fill").style.width =
        (badges.length ? (earned.length / badges.length) * 100 : 0) + "%";
}
// La presentación y búsqueda de compañeros se enlazan en design.js.
let loadSearch, studentCard;
function mergeHorarioRanges(horario) {
    // Agrupa las franjas horarias por día y fusiona las horas consecutivas
    // en rangos ("Mar 11:00–18:00"), mismo patrón de fusión que commonAvailability().
    const days = ["", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];
    const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const byDay = new Map();
    for (const h of horario) {
        const day = Number(h.dia_semana);
        if (!byDay.has(day)) byDay.set(day, []);
        byDay.get(day).push([minutes(h.hora_inicio), minutes(h.hora_fin)]);
    }
    const parts = [];
    for (const day of [...byDay.keys()].sort((a, b) => a - b)) {
        const merged = [];
        for (const row of byDay.get(day).sort((a, b) => a[0] - b[0])) {
            const last = merged.at(-1);
            if (last && row[0] <= last[1]) last[1] = Math.max(last[1], row[1]);
            else merged.push([...row]);
        }
        for (const [start, end] of merged)
            parts.push(`${days[day]} ${formatMinutes24h(start)}–${formatMinutes24h(end)}`);
    }
    return parts.join(" · ");
}
async function otherProfile(id) {
    const [result, mine] = await Promise.all([api("/estudiantes/" + id), api("/perfil/materias")]);
    selectedStudent = result.perfil;
    setText("modal-comp-nombre", selectedStudent.nombre);
    setText(
        "modal-comp-carrera",
        [selectedStudent.carrera, selectedStudent.ciclo].filter(Boolean).join(" · "),
    );
    const avatarEl = $("modal-comp-avatar");
    if (avatarEl) {
        avatarEl.textContent = initials(selectedStudent.nombre);
        if (selectedStudent.foto_url) {
            const image = document.createElement("img");
            image.src =
                Number(id) === Number(currentUser?.id)
                    ? "/api/perfil/foto?v=" + Date.now()
                    : selectedStudent.foto_url;
            image.alt = `Foto de ${selectedStudent.nombre}`;
            image.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:inherit;";
            avatarEl.replaceChildren(image);
        }
    }
    setText(
        "modal-comp-bio",
        selectedStudent.bio || "Este estudiante todavía no agregó una presentación.",
    );
    show("peer-email-verified", Boolean(selectedStudent.correo_verificado), "inline-block");
    for (const [role, target] of [
        ["ENSENAR", "modal-comp-teach-list"],
        ["APRENDER", "modal-comp-learn-list"],
    ]) {
        const subjects = result.materias.filter((m) => m.tipo_rol === role);
        $(target).innerHTML = subjects.length
            ? subjects
                  .map(
                      (m) =>
                          `<span class="tag ${role === "ENSENAR" ? "tag-purple" : "tag-green"}"><b>${escapeHtml(m.nombre)}</b> <span class="level">${escapeHtml(m.nivel.toLowerCase())}</span></span>`,
                  )
                  .join("")
            : empty("Sin materias registradas.");
    }
    const complementary = mine.filter((m) =>
        result.materias.some(
            (peer) => peer.materia_id === m.materia_id && peer.tipo_rol !== m.tipo_rol,
        ),
    ).length;
    setText(
        "modal-comp-match-val",
        mine.length ? Math.round((complementary * 100) / mine.length) + "%" : "—",
    );
    const self = Number(id) === Number(currentUser.id);
    show("modal-comp-match", !self, "inline-flex");
    show("modal-comp-actions-other", !self, "grid");
    show("modal-comp-actions-self", self, "flex");
    show("modal-comp-report-footer", !self);
    show("modal-comp-preview-badge", self, "inline-flex");
    show("modal-comp-bio-hint", self && !selectedStudent.bio);
    setText(
        "modal-comp-disponibilidad",
        result.horario.length
            ? "Disponibilidad: " + mergeHorarioRanges(result.horario)
            : "Sin disponibilidad registrada.",
    );
    show("modal-companero-perfil", true, "flex");
}
window.cerrarModalCompanero = () => show("modal-companero-perfil", false);
let sessionMatches = [],
    sessionAvailability = [],
    sessionBusy = [];
function fillSessionMentor() {
    const selected = $("sesion-materia").selectedOptions[0];
    const rows = sessionMatches.filter(
        (m) =>
            String(m.id) === $("sesion-materia").value &&
            (!selected?.dataset.mentorId || String(m.mentor_id) === selected.dataset.mentorId),
    );
    const mentors = [...new Set(rows.map((m) => String(m.mentor_id)))];
    $("sesion-mentor").replaceChildren(
        ...mentors.map(
            (id) =>
                new Option(
                    id === String(currentUser.id)
                        ? "Yo enseñaré"
                        : (selectedStudent?.nombre || reschedulingSessionRow?.companero || "Compañero") +
                          " enseñará",
                    id,
                ),
        ),
    );
    $("sesion-mentor").disabled = mentors.length <= 1;
    $("btn-enviar-propuesta-sesion").disabled = !rows.length;
}
function fillSessionSubjects() {
    const selected = $("sesion-materia").value,
        query = ($("sesion-materia-search")?.value || "").trim().toLocaleLowerCase();
    const rows = sessionMatches.filter((m) => m.nombre.toLocaleLowerCase().includes(query));
    const unique = [...new Map(rows.map((m) => [m.id + ":" + m.mentor_id, m])).values()];
    const peerLabel =
        selectedStudent?.nombre || reschedulingSessionRow?.companero || "Compañero";
    $("sesion-materia").replaceChildren(
        ...(unique.length
            ? unique.map((m) => {
                  const option = new Option(
                      m.nombre +
                          " · " +
                          (Number(m.mentor_id) === Number(currentUser.id)
                              ? "Tú enseñas"
                              : peerLabel + " enseña"),
                      m.id,
                  );
                  option.dataset.mentorId = String(m.mentor_id);
                  return option;
              })
            : [new Option("No hay materias coincidentes", "")]),
    );
    if (unique.some((m) => String(m.id) === selected)) $("sesion-materia").value = selected;
    $("sesion-materia").disabled = !unique.length;
    setText(
        "sesion-materia-status",
        unique.length
            ? "Solo materias donde uno enseña y el otro aprende."
            : "Registren materias complementarias en sus perfiles.",
    );
    fillSessionMentor();
}
function commonAvailability() {
    syncSessionAdvanceLabels();
    const date = $("sesion-fecha").value;
    const duration = Number($("sesion-duracion").value) * 60;
    if (!date) {
        setText(
            "sesion-disponibilidad",
            `Selecciona una fecha para ver la disponibilidad común (06:00–22:00, formato 24h).`,
        );
        $("sesion-hora").disabled = true;
        return [];
    }
    const day = new Date(date + "T12:00:00").getDay() || 7;
    const minutes = (value) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
    const merge = (rows) => {
        const merged = [];
        for (const row of rows
            .filter((h) => Number(h.dia_semana) === day)
            .map((h) => [
                Math.max(SCHEDULE_MIN_MINUTES, minutes(h.hora_inicio)),
                Math.min(SCHEDULE_MAX_MINUTES, minutes(h.hora_fin)),
            ])
            .filter((r) => r[0] < r[1])
            .sort((a, b) => a[0] - b[0])) {
            const last = merged.at(-1);
            if (last && row[0] <= last[1]) last[1] = Math.max(last[1], row[1]);
            else merged.push(row);
        }
        return merged;
    };
    const common = [];
    for (const a of merge(sessionAvailability[0]))
        for (const b of merge(sessionAvailability[1])) {
            const start = Math.max(a[0], b[0]),
                end = Math.min(a[1], b[1]);
            if (start < end) common.push([start, end]);
        }
    setText(
        "sesion-disponibilidad",
        common.length
            ? "Disponibilidad común (24h, máx. 22:00): " +
                  common.map((r) => `${formatMinutes24h(r[0])}–${formatMinutes24h(r[1])}`).join(" · ")
            : "No tienen disponibilidad en común este día (rango 06:00–22:00, 24h).",
    );
    const allowed = common.filter((r) => r[1] - r[0] >= duration);
    $("sesion-hora").disabled = !allowed.length;
    if (allowed.length) {
        $("sesion-hora").min = formatMinutes24h(allowed[0][0]);
        $("sesion-hora").max = formatMinutes24h(allowed.at(-1)[1] - duration);
    }
    return common;
}
function validateSessionTime() {
    const ranges = commonAvailability(),
        date = $("sesion-fecha").value,
        time = $("sesion-hora").value;
    if (!date || !time) throw new Error("Selecciona la fecha y hora (formato 24h) de la sesión.");
    const start = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)),
        duration = Number($("sesion-duracion").value) * 60;
    if (start < SCHEDULE_MIN_MINUTES || start + duration > SCHEDULE_MAX_MINUTES)
        throw new Error("El horario disponible es de 06:00 a 22:00 (formato 24h).");
    if (!ranges.some((r) => start >= r[0] && start + duration <= r[1]))
        throw new Error("La sesión completa debe estar dentro de la disponibilidad común de ambos (06:00–22:00).");
    const begin = new Date(buildPeruSessionDateTime(date, time)),
        end = new Date(begin.getTime() + duration * 60000);
    if (begin.getTime() <= Date.now()) {
        throw new Error("La fecha y hora elegidas deben ser posteriores al momento actual.");
    }
    if (reschedulingSessionId && !canRescheduleSession(reschedulingSessionRow)) {
        throw new Error(
            `Esta sesión ya no se puede reprogramar porque faltan menos de ${MIN_RESCHEDULE_ADVANCE_HOURS} horas para su inicio.`,
        );
    }
    if (
        sessionBusy.some((s) => {
            if (reschedulingSessionId && Number(s.id) === Number(reschedulingSessionId)) return false;
            const a = new Date(s.fecha_hora),
                b = new Date(a.getTime() + Number(s.duracion_programada_min) * 60000);
            return a < end && b > begin;
        })
    )
        throw new Error("Ya tienes otra sesión en ese horario.");
}
async function openRescheduleModal(sessionId) {
    const row = sessions.find((s) => Number(s.id) === Number(sessionId));
    if (!row) return;
    if (!canRescheduleSession(row)) {
        throw new Error(
            `Solo puedes reprogramar hasta ${MIN_RESCHEDULE_ADVANCE_HOURS} horas antes de que inicie la reunión.`,
        );
    }
    const peerId =
        Number(row.proponente_id) === Number(currentUser.id)
            ? row.receptor_id
            : row.proponente_id;
    const [matches, mine, other, busy] = await Promise.all([
        api("/estudiantes/" + peerId + "/coincidencias"),
        api("/perfil/horario"),
        api("/estudiantes/" + peerId),
        api("/sesiones"),
    ]);
    reschedulingSessionId = Number(row.id);
    reschedulingSessionRow = row;
    sessionMatches = matches.filter((m) => Number(m.id) === Number(row.materia_id));
    sessionAvailability = [mine, other.horario];
    sessionBusy = busy.filter((s) =>
        ["PROPUESTA", "CONFIRMADA", "EN_CURSO"].includes(s.estado),
    );
    if ($("sesion-materia-search")) $("sesion-materia-search").value = "";
    $("sesion-fecha").value = "";
    $("sesion-hora").value = "";
    $("sesion-hora").disabled = true;
    $("sesion-fecha").min = formatLocalDateInput(new Date());
    fillSessionSubjects();
    $("sesion-materia").value = String(row.materia_id);
    $("sesion-materia").disabled = true;
    $("sesion-mentor").value = String(row.mentor_id || currentUser.id);
    $("sesion-mentor").disabled = true;
    const hours = Math.max(
        1,
        Math.min(8, Math.round(Number(row.duracion_programada_min || 60) / 60)),
    );
    $("sesion-duracion").value = String(hours);
    commonAvailability();
    setText(
        "session-recipient-label",
        "Reprogramar sesión de " + row.materia + " con " + row.companero,
    );
    setText("btn-enviar-propuesta-sesion", "Confirmar reprogramación");
    show("modal-sesion", true, "flex");
}
window.proponerSesionDesdeCompanero = async () => {
    if (!selectedStudent) return;
    try {
        const [matches, mine, other, busy] = await Promise.all([
            api("/estudiantes/" + selectedStudent.id + "/coincidencias"),
            api("/perfil/horario"),
            api("/estudiantes/" + selectedStudent.id),
            api("/sesiones"),
        ]);
        reschedulingSessionId = null;
        reschedulingSessionRow = null;
        $("sesion-materia").disabled = false;
        $("sesion-mentor").disabled = false;
        setText("btn-enviar-propuesta-sesion", "Enviar propuesta");
        sessionMatches = matches;
        sessionAvailability = [mine, other.horario];
        sessionBusy = busy.filter((s) =>
            ["PROPUESTA", "CONFIRMADA", "EN_CURSO"].includes(s.estado),
        );
        if ($("sesion-materia-search")) $("sesion-materia-search").value = "";
        $("sesion-fecha").value = "";
        $("sesion-hora").value = "";
        $("sesion-hora").disabled = true;
        $("sesion-fecha").min = formatLocalDateInput(new Date());
        fillSessionSubjects();
        commonAvailability();
        show("modal-companero-perfil", false);
        setText("session-recipient-label", "Proponer una sesión a " + selectedStudent.nombre);
        show("modal-sesion", true, "flex");
    } catch (error) {
        notify(error.message, true);
    }
};
window.irAlChatDesdeCompanero = async () => {
    try {
        if (!selectedStudent) return;
        const row = await api("/conversaciones", "POST", { estudiante_id: selectedStudent.id });
        show("modal-companero-perfil", false);
        await loadConversations();
        await openConversation(row.id);
        navigate("chat-section");
    } catch (e) {
        notify(e.message, true);
    }
};
async function loadNotifications() {
    const rows = await api("/notificaciones");
    $("notifications-live").innerHTML = rows.length
        ? rows
              .map(
                  (n) =>
                      `<div class="section-card" style="margin:0;${n.leida ? "" : "border-left:4px solid var(--primary);"}"><h3 style="font-size:15px;">${escapeHtml(repairMojibake(n.titulo))}</h3><p style="font-size:13px;margin:8px 0;color:var(--text-muted);">${escapeHtml(repairMojibake(n.mensaje))}</p><small>${escapeHtml(dateText(n.creada_en))}</small><div style="display:flex;gap:10px;margin-top:12px;">${!n.leida ? `<button class="btn btn-secondary" data-read="${n.id}">Marcar como leída</button>` : ""}${n.tipo_evento === "PROPUESTA_SESION" ? '<button class="btn btn-primary" data-go-sessions>Ver sesiones</button>' : ""}</div></div>`,
              )
              .join("")
        : empty("No tienes notificaciones.");
    const unread = rows.some((n) => !n.leida);
    show("rf38-badge-sidebar-notif", unread, "inline-flex");
    show("rf38-punto-rojo-campana", unread);
}
async function loadConversations() {
    conversations = await api("/conversaciones");
    renderConversations();
}
function renderConversations() {
    const q = $("chat-search-input").value.toLowerCase(),
        rows = conversations.filter((c) => c.nombre.toLowerCase().includes(q));
    $("chat-conversation-list").innerHTML = rows.length
        ? rows
              .map(
                  (c) =>
                      `<button class="chat-conversation-item ${c.id === selectedConversation?.id ? "active" : ""}" data-conversation="${c.id}" style="display:flex;gap:12px;text-align:left;padding:16px;border:0;border-radius:10px;background:${c.id === selectedConversation?.id ? "var(--primary-light)" : "white"};cursor:pointer;width:100%;"><div class="user-avatar-small" style="background:var(--primary);">${escapeHtml(initials(c.nombre))}</div><div><strong>${escapeHtml(c.nombre)}</strong><p style="font-size:12px;color:var(--text-muted);margin-top:5px;">Conversación${Number(c.no_leidos) ? " · " + c.no_leidos + " sin leer" : ""}</p></div></button>`,
              )
              .join("")
        : empty("No tienes conversaciones. Busca un compañero para empezar.");
    if (!selectedConversation) {
        setText("chat-active-name", "Selecciona una conversación");
        setText("chat-active-avatar", "");
        setText("chat-active-badge", "");
        $("chat-messages-container").innerHTML = empty("Aquí aparecerán tus mensajes.");
        $("chat-input-mensaje").disabled = true;
    }
}
async function openConversation(id) {
    selectedConversation = conversations.find((c) => c.id === Number(id));
    if (!selectedConversation) return;
    setText("chat-active-name", selectedConversation.nombre);
    setText("chat-active-avatar", initials(selectedConversation.nombre));
    setText("chat-active-badge", "Conversación");
    show("chat-banner-cerrado", selectedConversation.estado !== "ACTIVA", "flex");
    $("chat-input-mensaje").disabled = selectedConversation.estado !== "ACTIVA";
    renderConversations();
    await loadMessages();
}
async function loadMessages() {
    if (!selectedConversation) return;
    const id = selectedConversation.id,
        rows = await api(`/conversaciones/${id}/mensajes`);
    if (selectedConversation?.id !== id) return;
    $("chat-messages-container").innerHTML = rows.length
        ? rows.map(messageBubble).join("")
        : empty("Todavía no hay mensajes en esta conversación.");
}
function messageBubble(m) {
    const mine = m.emisor_id === currentUser.id;
    let content = repairMojibake(String(m.texto))
        .split(/(https?:\/\/[^\s]+)/g)
        .map((part) =>
            /^https?:\/\//.test(part)
                ? `<a href="${escapeHtml(part)}" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline;font-weight:600;">${escapeHtml(part)}</a>`
                : escapeHtml(part),
        )
        .join("");
    if (m.archivo) {
        const file = m.archivo;
        content = `<a href="${escapeHtml(file.url)}" target="_blank" rel="noopener noreferrer" style="color:inherit;">${file.tipo.startsWith("image/") ? `<img src="${escapeHtml(file.url)}" alt="${escapeHtml(file.nombre)}" style="max-width:260px;max-height:260px;object-fit:contain;border-radius:10px;display:block;margin-bottom:8px;">` : '<i class="fa-solid fa-file-arrow-down" style="margin-right:8px;"></i>'}${escapeHtml(file.nombre)}</a>`;
    }
    return `<div style="display:flex;justify-content:${mine ? "flex-end" : "flex-start"};align-items:flex-end;gap:8px;margin-bottom:14px;width:100%;">${mine ? "" : `<div data-chat-peer="true" role="button" tabindex="0" title="Ver perfil · Clic derecho para proponer sesión" style="cursor:pointer;width:32px;height:32px;border-radius:50%;background:var(--primary);color:white;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;margin-bottom:18px;">${escapeHtml(initials(m.autor))}</div>`}<div style="max-width:72%;display:flex;flex-direction:column;align-items:${mine ? "flex-end" : "flex-start"};"><div style="background:${mine ? "linear-gradient(135deg,#b30832 0%,#910729 100%)" : "#f8fafc"};border:${mine ? "none" : "1px solid #e2e8f0"};color:${mine ? "white" : "#1e293b"};padding:11px 16px;border-radius:${mine ? "16px 16px 3px 16px" : "16px 16px 16px 3px"};font-size:13.5px;line-height:1.45;box-shadow:0 2px 8px #0001;white-space:pre-wrap;word-break:break-word;">${content}</div><div style="display:flex;align-items:center;margin-top:4px;font-size:11px;color:#94a3b8;"><span>${escapeHtml(dateText(m.enviado_en))}</span>${mine ? `<i class="fa-solid ${m.leido ? "fa-check-double" : "fa-check"}" title="${m.leido ? "Leído" : "Enviado"}" style="color:${m.leido ? "#0891b2" : "#94a3b8"};font-size:11px;margin-left:6px;"></i>` : ""}</div></div></div>`;
}
function chatPeerId() {
    if (!selectedConversation) throw new Error("Selecciona una conversación.");
    return Number(selectedConversation.estudiante_a) === Number(currentUser.id)
        ? selectedConversation.estudiante_b
        : selectedConversation.estudiante_a;
}
async function proposeFromChat() {
    hidePopoverSafe($("chat-peer-menu"));
    const peer = await api("/estudiantes/" + chatPeerId());
    selectedStudent = peer.perfil;
    await window.proponerSesionDesdeCompanero();
}
function openChatMenu(event) {
    if (!selectedConversation) return;
    event?.preventDefault?.();
    const anchor = $("chat-peer-profile")?.getBoundingClientRect() || { left: 16, bottom: 80 },
        menu = $("chat-peer-menu");
    if (!menu) return;
    menu.style.position = "fixed";
    menu.style.zIndex = "9999";
    menu.style.left =
        Math.max(8, Math.min(event?.clientX || anchor.left, window.innerWidth - 220)) + "px";
    menu.style.top =
        Math.max(8, Math.min(event?.clientY || anchor.bottom, window.innerHeight - 110)) + "px";
    showPopoverSafe(menu);
}
async function sendMessage() {
    if (!selectedConversation) throw new Error("Selecciona una conversación.");
    await api(`/conversaciones/${selectedConversation.id}/mensajes`, "POST", {
        texto: $("chat-input-mensaje").value,
    });
    $("chat-input-mensaje").value = "";
    await loadMessages();
    $("chat-messages-container").scrollTop = $("chat-messages-container").scrollHeight;
}
async function loadRanking() {
    const access = await api("/suscripciones/acceso");
    if (!access.pro) {
        show("ranking-empty-state", true);
        show("ranking-table-container", false);
        show("ranking-podium-container", false);
        $("ranking-empty-state").innerHTML = empty("El ranking es un beneficio de Pro-Ciclo. Actívalo desde Plan Pro-Ciclo.");
        return;
    }
    const rows = await api("/ranking");
    show("ranking-empty-state", !rows.length);
    show("ranking-table-container", !!rows.length);
    show("ranking-podium-container", !!rows.length, "grid");
    $("ranking-table-body").innerHTML = rows
        .map(
            (r, i) =>
                `<tr style="border-bottom:1px solid var(--border-color);"><td style="padding:16px;">${r.posicion || i + 1}</td><td style="padding:16px;"><strong>${escapeHtml(r.nombre)}</strong><p style="font-size:11px;color:var(--text-muted);">${escapeHtml(r.carrera)}</p></td><td>${escapeHtml(r.insignia || "Sin insignias")}</td><td>${r.sesiones_completadas}</td><td>${Number(r.horas_ensenadas).toFixed(1)}h</td></tr>`,
        )
        .join("");
    $("ranking-podium-container").replaceChildren();
    for (const rank of [2, 1, 3]) {
        const r = rows[rank - 1];
        if (!r) {
            $("ranking-podium-container").append(document.createElement("div"));
            continue;
        }
        const card = $("podium-card-" + rank).content.firstElementChild.cloneNode(true);
        for (const [field, value] of [
            ["nombre", r.nombre],
            ["carrera", r.carrera],
            ["horasEnsenadas", Number(r.horas_ensenadas).toFixed(1) + " hrs"],
            ["sesionesCompletadas", r.sesiones_completadas + " sesiones"],
        ])
            card.querySelector(`[data-field="${field}"]`).textContent = value;
        $("ranking-podium-container").append(card);
    }
    const index = rows.findIndex((r) => r.id === currentUser.id);
    show("ranking-propio-card", index >= 0, "flex");
    if (index >= 0) {
        setText("mi-ranking-avatar", initials(currentUser.nombre));
        setText("mi-ranking-titulo", `Puesto #${rows[index].posicion || index + 1} · ${currentUser.nombre}`);
        setText("mi-ranking-horas", Number(rows[index].horas_ensenadas).toFixed(1) + "h");
        setText("mi-ranking-badge", "Tu posición actual");
    }
}
async function loadSubscriptions() {
    [subscriptions, plans] = await Promise.all([api("/suscripciones"), api("/planes")]);
    const active = subscriptions.find((s) => ["ACTIVO", "TRIAL"].includes(s.estado_actual));
    const latest = active || subscriptions[0] || null;

    const isPaidActive = Boolean(active && active.estado_actual === "ACTIVO");
    const isTrialActive = Boolean(active && active.estado_actual === "TRIAL");

    const name = isPaidActive
        ? active.plan || "Plan Pro Ciclo"
        : isTrialActive
          ? active.plan || "Prueba Activa"
          : "Plan Gratuito";
    const state = isPaidActive ? "ACTIVO" : isTrialActive ? "TRIAL" : "GRATUITO";

    for (const id of ["mi-plan-card-titulo", "rf37-titulo-plan"]) setText(id, name);
    for (const id of ["rf34-top-text", "mi-plan-card-badge", "rf37-badge-activa"])
        setText(id, state);

    const venceDate = computePlanExpiration(active || latest, currentUser);
    const textoVencimiento = formatExpirationDate(venceDate);

    setText("mi-plan-fecha-vence", textoVencimiento);
    setText("rf37-fecha-vigencia", textoVencimiento);

    if (isPaidActive) {
        setText(
            "mi-plan-dias-subtext",
            `Tu suscripción está activa. Disfrutarás de tu plan hasta el ${textoVencimiento}.`,
        );
    } else if (isTrialActive) {
        setText(
            "mi-plan-dias-subtext",
            `Tu periodo de prueba está activo hasta el ${textoVencimiento}.`,
        );
    } else {
        setText(
            "mi-plan-dias-subtext",
            `Cuentas con 2 meses de prueba gratis. Tu plan gratuito vence el ${textoVencimiento}.`,
        );
    }

    setText(
        "current-plan-match",
        isPaidActive ? "Emparejamientos ilimitados" : "Modelo Freemium · 2 meses de prueba gratis",
    );
    setText(
        "current-plan-filters",
        isPaidActive ? "Filtros avanzados de búsqueda" : "Búsqueda básica por nombre y materia",
    );
    setText(
        "current-plan-ranking",
        isPaidActive ? "Acceso al ranking de mentores" : "Ranking disponible con Plan Pro Ciclo",
    );
    setText(
        "current-plan-badge",
        isPaidActive
            ? "Certificación de horas de mentoría universitaria e insignias"
            : "Insignias por horas de mentoría",
    );

    const activePlan = plans.find((p) => p.id === active?.plan_id);
    document.querySelectorAll("[data-plan-benefits]").forEach((e) => {
        e.innerHTML = activePlan
            ? activePlan.beneficios
                  .map((b) => `<li style="margin:8px 0;">${escapeHtml(b.texto)}</li>`)
                  .join("")
            : isPaidActive
              ? '<li style="margin:8px 0;">Emparejamientos ilimitados y certificación de horas de mentoría universitaria.</li>'
              : '<li style="margin:8px 0;">2 meses de prueba gratis en modelo Freemium.</li>';
    });

    show("sidebar-pro-badge", Boolean(active), "inline-block");
    setText("sidebar-pro-badge", state);

    const days = venceDate ? Math.ceil((venceDate.getTime() - Date.now()) / 86400000) : null;
    show("rf38-banner-amarillo-dashboard", days !== null && days >= 0 && days <= 7, "flex");
    if (days !== null) {
        setText("rf38-txt-dias-banner", days);
        setText("rf38-txt-fecha-banner", textoVencimiento);
    }

    const payments = await api("/pagos");
    setText("rf37-contador-transacciones", payments.length + " transacciones");
    $("rf37-tbody-historial").innerHTML = payments.length
        ? payments
              .map(
                  (p) =>
                      `<tr><td style="padding:14px;">${escapeHtml(dateText(p.pagado_en))}</td><td>${escapeHtml(p.modalidad)}</td><td>${escapeHtml(p.moneda)} ${escapeHtml(p.monto)}</td><td>${escapeHtml(p.marca_tarjeta || "—")}</td><td>${escapeHtml(p.numero_comprobante || "—")}</td><td>—</td><td>${escapeHtml(p.estado)}</td><td>${p.estado === "COMPLETADO" ? `<button class="btn" data-receipt="${p.id}">Ver registro</button>` : "—"}</td></tr>`,
              )
              .join("")
        : '<tr><td colspan="8" style="padding:28px;text-align:center;">No tienes pagos registrados.</td></tr>';
}
let selectedPlan = null;
let paymentReference = null;
let paymentBusy = false;
let lastDemoPayment = null;
function updatePaymentMode() {
    const monthly = $("radio-modalidad-mensual")?.checked;
    const plan = plans.find(
        (p) =>
            Number(p.precio) > 0 &&
            (monthly ? /mes/i.test(p.periodo) : /semestr|ciclo|seman/i.test(p.periodo)),
    );
    if (plan) selectedPlan = plan;
    if (!selectedPlan) return;
    const amount = `${selectedPlan.moneda} ${Number(selectedPlan.precio).toFixed(2)}`;
    setText("rf36-txt-monto-final", Number(selectedPlan.precio).toFixed(2));
    setText("rf36-btn-monto", amount);
    setText("btn-confirmar-pago-pasarela", "Activar Pro Ciclo · " + amount);
    for (const mode of ["mensual", "semestral"]) {
        const radio = $("radio-modalidad-" + mode);
        const label = radio?.closest("label");
        if (label) {
            label.style.borderColor = radio?.checked ? "#b60d30" : "#e2e8f0";
            label.style.background = radio?.checked ? "#fef2f2" : "white";
        }
    }
}
function openPlan(id) {
    selectedPlan = plans.find((p) => p.id === Number(id));
    if (!selectedPlan) return;
    setText("rf35-modal-nombre-plan", selectedPlan.nombre);
    setText("rf35-modal-periodo", selectedPlan.periodo);
    setText(
        "rf35-modal-precio",
        Number(selectedPlan.precio).toFixed(2),
    );
    if ($("rf35-modal-lista-beneficios"))
        $("rf35-modal-lista-beneficios").innerHTML = selectedPlan.beneficios
            .map((b) => `<li>${escapeHtml(b.texto)}</li>`)
            .join("");
    show("modal-contratacion-plan", true, "flex");
}
function openDemoPayment() {
    paymentReference = createReferenceId();
    setText("rf36-exito-comprobante", "—");
    $("rf36-input-titular").value = currentUser?.nombre || "";
    if (!selectedPlan) throw new Error("Selecciona un plan.");
    show("modal-contratacion-plan", false);
    show("modal-pasarela-pago", true, "flex");
    show("rf36-banner-error", false);
    const price = `${selectedPlan.moneda} ${Number(selectedPlan.precio).toFixed(2)}`;
    setText("rf36-txt-monto-final", price);
    setText("rf36-btn-monto", price);
    setText("demo-payment-price", price);
    updatePaymentMode();
    const simulationTools = $("btn-rf36-sim-exito")?.parentElement?.parentElement;
    if (simulationTools) simulationTools.style.display = "none";
}
async function paymentDemo(scenario = "APROBADO") {
    if (paymentBusy) return;
    if (!selectedPlan) throw new Error("Selecciona un plan.");
    const card = $("rf36-input-tarjeta").value.replace(/\s/g, "");
    if (scenario === "APROBADO") {
        if (card !== "4111111111111111") throw new Error("Tarjeta no habilitada para esta presentación.");
        if (!/^\d{2}\/\d{2}$/.test($("rf36-input-vence").value) ||
            !/^\d{3}$/.test($("rf36-input-cvv").value) ||
            !$("rf36-input-titular").value.trim())
            throw new Error("Completa el titular, vencimiento MM/AA y CVV de tres dígitos.");
        const [month, year] = $("rf36-input-vence").value.split("/").map(Number);
        if (month < 1 || month > 12 || new Date(2000 + year, month, 1) <= new Date())
            throw new Error("La fecha de vencimiento no es válida.");
    }
    paymentBusy = true;
    $("btn-confirmar-pago-pasarela").disabled = true;
    try {
        const result = await api("/pagos/prueba", "POST", {
            plan_id: selectedPlan.id, escenario: scenario,
            referencia: paymentReference || (paymentReference = createReferenceId()),
            tarjeta_prueba: card, renovar: true,
        });
        if (result.estado === "APROBADO") {
            lastDemoPayment = result.pago_id;
            setText("rf36-exito-comprobante", result.numero_comprobante);
            show("modal-pasarela-pago", false);
            setText("rf36-exito-monto", `${result.plan.moneda} ${Number(result.plan.precio).toFixed(2)}`);
            show("modal-pago-exito", true, "flex");
            await loadSubscriptions();

            const expServer = parseServerDate(result.fecha_vencimiento);
            const fechaHasta = expServer
                ? formatExpirationDate(expServer)
                : $("mi-plan-fecha-vence")?.textContent;
            notify(
                fechaHasta && fechaHasta !== "Sin vencimiento"
                    ? `Suscripción activada. Disfrutarás de tu plan hasta el ${fechaHasta}.`
                    : "Plan Pro-Ciclo activado correctamente.",
            );
        } else {
            paymentReference = createReferenceId();
            setText("rf36-banner-error-title", result.estado === "TIMEOUT" ? "Tiempo de espera agotado" : "Pago rechazado");
            setText("rf36-banner-error-desc", result.mensaje);
            show("rf36-banner-error", true, "flex");
            notify(
                result.estado === "TIMEOUT"
                    ? "Se agotó el tiempo de espera. Intenta nuevamente."
                    : "Pago rechazado. Revisa los datos e intenta nuevamente.",
                true,
            );
        }
    } finally {
        paymentBusy = false;
        $("btn-confirmar-pago-pasarela").disabled = false;
    }
}

async function loadDocuments() {
    hideDocumentsTab();
    if ($("uploaded-files-list")) $("uploaded-files-list").innerHTML = "";
}
function reports() {
    const subject = $("select-filtro-curso-reporte").value,
        rows = sessions.filter(
            (s) => s.estado === "COMPLETADA" && (!subject || s.materia_id === Number(subject)),
        );
    const peers = new Set(
        rows.map((s) => (s.proponente_id === currentUser.id ? s.receptor_id : s.proponente_id)),
    );
    setText("reporte-metric-estudiantes", peers.size + " compañeros");
    setText("reporte-metric-asesorias", rows.length + " sesiones");
    setText(
        "reporte-metric-horas",
        (rows.reduce((sum, s) => sum + Number(s.duracion_real_min || 0), 0) / 60).toFixed(1) +
            " horas",
    );
    setText("reporte-tabla-titulo", "Detalle de tus sesiones completadas");
    $("reporte-tabla-body").innerHTML = rows.length
        ? rows
              .map(
                  (s) =>
                      `<tr><td style="padding:14px;">${escapeHtml(dateText(s.fecha_hora))}</td><td>${escapeHtml(s.mentor_id === currentUser.id ? currentUser.nombre : s.companero)}</td><td>${escapeHtml(s.materia)}</td><td style="text-align:center;">2</td><td style="text-align:right;">${escapeHtml(s.duracion_real_min)} min</td></tr>`,
              )
              .join("")
        : '<tr><td colspan="5" style="padding:24px;text-align:center;">No hay sesiones completadas para este filtro.</td></tr>';
}
async function navigate(id, reload = true) {
    document
        .querySelectorAll(".page-section")
        .forEach((e) => e.classList.toggle("active", e.id === id));
    document
        .querySelectorAll(".nav-item")
        .forEach((e) => e.classList.toggle("active", e.dataset.target === id));
    if (!reload) return;
    const tasks = {
        "inicio-section": async () => {
            await Promise.all([loadSessions(), loadBadges(), loadSearch()]);
            await loadHours();
        },
        "perfil-section": async () => {
            await loadCatalogs();
            currentUser = await api("/auth/yo");
            profile();
            await Promise.all([
                loadSubjects(),
                loadMySubjects(),
                loadSchedule(),
                loadHours(),
                loadDocuments(),
            ]);
        },
        "buscar-section": async () => {
            await loadCatalogs();
            await loadSearch();
        },
        "mis-sesiones-section": loadSessions,
        "notificaciones-section": loadNotifications,
        "chat-section": loadConversations,
        "insignias-section": loadBadges,
        "ranking-section": loadRanking,
        "suscripcion-section": loadSubscriptions,
        "reportes-section": async () => {
            await loadSessions();
            reports();
        },
    };
    if (tasks[id])
        try {
            await tasks[id]();
        } catch (e) {
            notify(e.message, true);
        }
    window.designNavigated?.(id);
}
window.navegarASeccion = navigate;

document.addEventListener("DOMContentLoaded", async () => {
    setupSubjectSearch();
    setupEnterActions();
    setupAppDialog();
    syncSessionAdvanceLabels();
    paintSessionTabs();
    hideDocumentsTab();
    // 1. Mostrar / ocultar contraseña (ojito)
    document.querySelectorAll('input[type="password"]').forEach((input) => {
        const btn = input.parentElement?.querySelector("button");
        if (!btn) return;
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const showPass = input.type === "password";
            input.type = showPass ? "text" : "password";
            const icon = btn.querySelector("i");
            if (icon) {
                icon.classList.toggle("fa-eye", !showPass);
                icon.classList.toggle("fa-eye-slash", showPass);
            }
        });
    });

    // 2. Menú hamburguesa en móvil
    $("btn-mobile-menu")?.addEventListener("click", (e) => {
        e.stopPropagation();
        document.querySelector(".sidebar")?.classList.toggle("open");
    });
    document.querySelectorAll(".nav-item").forEach((item) => {
        item.addEventListener("click", () => {
            document.querySelector(".sidebar")?.classList.remove("open");
        });
    });
    document.addEventListener("click", (e) => {
        const sidebar = document.querySelector(".sidebar");
        if (sidebar?.classList.contains("open") && !sidebar.contains(e.target) && e.target.id !== "btn-mobile-menu") {
            sidebar.classList.remove("open");
        }
        const profileMenu = document.querySelector(".topbar-profile-menu");
        if (profileMenu && !profileMenu.contains(e.target)) {
            closeTopbarProfileMenu();
        }
    });

    // Menú desplegable de perfil en el topbar (Cerrar sesión)
    const toggleTopbarProfileMenu = (e) => {
        e.stopPropagation();
        const dropdown = $("topbar-profile-dropdown");
        const avatar = $("topbar-user-avatar");
        if (!dropdown || !avatar) return;
        const willOpen = dropdown.style.display !== "block";
        dropdown.style.display = willOpen ? "block" : "none";
        avatar.setAttribute("aria-expanded", String(willOpen));
    };
    $("topbar-user-avatar")?.addEventListener("click", toggleTopbarProfileMenu);
    $("topbar-user-avatar")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggleTopbarProfileMenu(e);
        }
    });
    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") closeTopbarProfileMenu();
    });

    // 3. Botón quitar foto de perfil
    on("btn-remove-photo", async () => {
        await api("/perfil/foto", "DELETE");
        currentUser = await api("/auth/yo");
        profile();
        notify("Foto de perfil eliminada.");
    });
    for (const [id, page] of [
        ["link-to-register", "register-section"],
        ["link-to-login", "login-section"],
        ["link-to-recover", "recover-section"],
        ["link-recover-to-login", "login-section"],
        ["link-sent-to-login", "login-section"],
        ["link-verify-to-login", "login-section"],
    ])
        on(id, async () => {
            authPage(page);
            if (page === "register-section") await loadCatalogs();
        });
    on("btn-login", async () =>
        signedIn(
            await api("/auth/login", "POST", {
                correo: $("login-email").value,
                contrasena: $("login-password").value,
            }),
        ),
    );
    $("reg-email").addEventListener("input", () => $("reg-email").setCustomValidity(""));
    on("btn-register", async () => {
        const email = $("reg-email");
        email.value = email.value.trim().toLowerCase();
        email.setCustomValidity(
            /^[^\s@]+@utp\.edu\.pe$/.test(email.value)
                ? ""
                : "Usa tu correo institucional terminado en @utp.edu.pe.",
        );
        if (!email.reportValidity()) return;
        await signedIn(
            await api("/auth/registro", "POST", {
                nombre: $("reg-name").value,
                correo: email.value,
                contrasena: $("reg-password").value,
                carrera: $("reg-career").value,
                ciclo: $("reg-cycle").value,
            }),
        );
    });
    on("btn-verify", async () =>
        signedIn(await api("/auth/verificar", "POST", { codigo: $("verify-code").value.trim() })),
    );
    on("btn-resend-code", sendVerificationEmail);
    const executeLogout = async () => {
        closeTopbarProfileMenu();
        await api("/auth/logout", "POST");
        loggedOut();
        await token();
    };
    on("btn-logout", executeLogout);
    on("btn-dropdown-logout", executeLogout);
    on("btn-recover", async () => {
        const result = await api("/auth/recuperar", "POST", { correo: $("recover-email").value });
        notify(repairMojibake(result.mensaje));
        authPage("recover-sent-section");
    });
    on("btn-reset", async () => {
        const result = await api("/auth/restablecer", "POST", {
            token: new URLSearchParams(location.search).get("reset"),
            contrasena: $("reset-password").value,
        });
        history.replaceState(null, "", location.pathname);
        authPage("login-section");
        notify(repairMojibake(result.mensaje));
    });
    document
        .querySelectorAll(".nav-item[data-target]")
        .forEach((e) => e.addEventListener("click", () => navigate(e.dataset.target)));
    document.querySelectorAll("#tab-informacion .sub-tabs-container .tab").forEach((e) =>
        e.addEventListener("click", () => {
            e.parentElement
                .querySelectorAll(".tab")
                .forEach((t) => t.classList.toggle("active", t === e));
            document
                .querySelectorAll("#tab-informacion > .tab-content")
                .forEach((t) => t.classList.toggle("active", t.id === e.dataset.target));
        }),
    );
    on("btn-save-profile", async () => {
        currentUser = await api("/perfil", "PUT", {
            nombre: $("perfil-nombre").value,
            carrera: $("perfil-carrera").value,
            ciclo: $("perfil-ciclo").value,
            bio: $("perfil-bio").value,
            push_activo: currentUser.push_activo,
        });
        profile();
        notify("Perfil guardado en tu cuenta.");
    });
    on("btn-cancel-profile", profile);
    $("btn-delete-account")?.addEventListener(
        "click",
        (e) => {
            e.preventDefault();
            e.stopImmediatePropagation();
            const box = $("desactivar-cuenta-box");
            if (!box) return;
            const visible = box.style.display === "block";
            box.style.display = visible ? "none" : "block";
            if (!visible) {
                $("desactivar-password").value = "";
                $("desactivar-password").focus();
            }
        },
        true,
    );

    on("btn-cancelar-desactivar-cuenta", () => {
        $("desactivar-password").value = "";
        show("desactivar-cuenta-box", false);
    });

    on("btn-confirmar-desactivar-cuenta", async () => {
        const contrasena = $("desactivar-password").value;
        if (!contrasena.trim()) {
            notify("Ingresa tu contraseña actual para desactivar la cuenta.", true);
            $("desactivar-password").focus();
            return;
        }
        await api("/cuenta", "DELETE", { contrasena });
        $("desactivar-password").value = "";
        show("desactivar-cuenta-box", false);
        loggedOut();
        await token();
        notify("Cuenta desactivada.");
    });
    for (const [prefix, role] of [
        ["teach", "ENSENAR"],
        ["learn", "APRENDER"],
    ])
        on("btn-add-" + prefix, async () => {
            await api("/perfil/materias", "POST", {
                materia_id: subjectValue(prefix),
                tipo_rol: role,
                nivel: $(prefix + "-level").value,
            });
            await loadMySubjects();
            notify("Materia guardada.");
        });
    on("btn-save-schedule", async () => {
        const slots = Array.from(selectedSlots).map((key) => {
            const [day, hour] = key.split(":").map(Number);
            return {
                dia_semana: day,
                hora_inicio: String(hour).padStart(2, "0") + ":00",
                hora_fin: String(hour + 1).padStart(2, "0") + ":00",
            };
        });
        await api("/perfil/horario", "PUT", slots);
        await loadSchedule();
        notify("Disponibilidad guardada.");
    });
    on("btn-cancel-schedule", resetSchedule);
    on(
        "file-upload",
        () => {
            const f = $("file-upload").files[0];
            if (!f) return;
            setText("confirm-file-name", f.name);
            setText("confirm-file-size", (f.size / 1024 / 1024).toFixed(2) + " MB");
            show("upload-drop-area", false);
            show("upload-confirm-area", true);
        },
        "change",
    );
    $("upload-drop-area")?.addEventListener("dragover", (e) => {
        e.preventDefault();
    });
    $("upload-drop-area")?.addEventListener("drop", (e) => {
        e.preventDefault();
        if (!e.dataTransfer.files.length) return;
        $("file-upload").files = e.dataTransfer.files;
        $("file-upload").dispatchEvent(new Event("change"));
    });
    on("btn-cancel-upload", () => {
        show("upload-confirm-area", false);
        show("upload-drop-area", true);
        $("file-upload").value = "";
    });
    on("btn-confirm-upload", async () => {
        const file = $("file-upload").files[0];
        if (!file) throw new Error("Selecciona un archivo.");
        const data = new FormData();
        data.append("archivo", file);
        await api("/documentos", "POST", data);
        show("upload-confirm-area", false);
        show("upload-drop-area", true);
        $("file-upload").value = "";
        await loadDocuments();
        notify("Documento guardado.");
    });
    on(
        "photo-upload",
        async () => {
            const file = $("photo-upload").files[0];
            if (!file) return;
            const data = new FormData();
            data.append("archivo", file);
            await api("/perfil/foto", "POST", data);
            currentUser = await api("/auth/yo");
            profile();
            notify("Foto guardada.");
        },
        "change",
    );
    on("btn-manual-search", async () => {
        const resultado=await api("/emparejamientos/buscar","POST");
        await loadSearch();
        notify(resultado.encontrado ? "Nuevo compañero encontrado." : "No hay compañeros disponibles con tus materias y horarios.");
    });
    let searchTimer;
    $("search-input").addEventListener("input", () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => loadSearch().catch((e) => notify(e.message, true)), 300);
    });
    on("btn-toggle-filters", () =>
        show("filter-panel", $("filter-panel").style.display === "none"),
    );
    on("btn-apply-filters", loadSearch);
    on("btn-clear-filters", async () => {
        $("filter-career").value = "Todos";
        $("quick-filter-course").value = "";
        $("quick-filter-day").value = "";
        $("search-input").value = "";
        await loadSearch();
    });
    on("btn-clear-search", async () => {
        $("search-input").value = "";
        await loadSearch();
    });
    $("sesion-materia-search")?.addEventListener("input", fillSessionSubjects);
    $("sesion-materia").addEventListener("change", fillSessionMentor);
    for (const id of ["sesion-fecha", "sesion-duracion"])
        $(id).addEventListener("change", commonAvailability);
    on("btn-enviar-propuesta-sesion", async () => {
        validateSessionTime();
        const fechaHora = buildPeruSessionDateTime($("sesion-fecha").value, $("sesion-hora").value);
        if (reschedulingSessionId) {
            await api(`/sesiones/${reschedulingSessionId}/reprogramar`, "POST", {
                fecha_hora: fechaHora,
                duracion_programada_min: Number($("sesion-duracion").value) * 60,
            });
            reschedulingSessionId = null;
            reschedulingSessionRow = null;
            $("sesion-materia").disabled = false;
            $("sesion-mentor").disabled = false;
            syncSessionAdvanceLabels();
            setText("btn-enviar-propuesta-sesion", "Enviar propuesta");
            show("modal-sesion", false);
            await loadSessions();
            notify("Sesión reprogramada correctamente.");
            return;
        }
        if (!selectedStudent) throw new Error("Selecciona un compañero.");
        await api("/sesiones", "POST", {
            receptor_id: Number(selectedStudent.id),
            materia_id: Number($("sesion-materia").value),
            fecha_hora: fechaHora,
            duracion_programada_min: Number($("sesion-duracion").value) * 60,
            mentor_id: Number($("sesion-mentor").value),
        });
        show("modal-sesion", false);
        await loadSessions();
        notify("Propuesta guardada y enviada al compañero.");
        navigate("mis-sesiones-section");
    });
    for (const [button, modal] of [
        ["btn-close-modal-sesion", "modal-sesion"],
        ["btn-close-modal-calificacion", "modal-calificacion"],
        ["btn-cancelar-calificacion", "modal-calificacion"],
        ["btn-close-modal-cancelacion", "modal-cancelacion"],
        ["btn-cancel-cancelacion", "modal-cancelacion"],
        ["btn-cancelar-oferta", "modal-contratacion-plan"],
        ["btn-cancelar-proceso-contratacion", "modal-contratacion-plan"],
    ])
        on(button, () => {
            if (modal === "modal-sesion") {
                reschedulingSessionId = null;
                reschedulingSessionRow = null;
                $("sesion-materia").disabled = false;
                $("sesion-mentor").disabled = false;
                syncSessionAdvanceLabels();
                setText("btn-enviar-propuesta-sesion", "Enviar propuesta");
            }
            show(modal, false);
        });
    on("btn-confirmar-cancelacion", async () => {
        await api(`/sesiones/${selectedCancellation}/cancelar`, "POST", {
            motivo: $("cancelacion-motivo").value,
        });
        show("modal-cancelacion", false);
        await loadSessions();
        notify("Sesión cancelada.");
    });
    on("tab-proximas", () => {
        pastSessions = false;
        renderSessions();
        setTimeout(paintSessionTabs, 0);
    });
    on("tab-pasadas", () => {
        pastSessions = true;
        renderSessions();
        setTimeout(paintSessionTabs, 0);
    });
    on("btn-rf027-refresh", async () => {
        await loadSessions();
        notify("Sesiones actualizadas.");
    });
    on("btn-rf033-refresh", loadRanking);
    on("btn-back-notifs", () => navigate("notificaciones-section"));
    on("btn-back-notifs-sesion", () => navigate("notificaciones-section"));
    document.querySelectorAll(".star-item").forEach((e) =>
        e.addEventListener("click", () => {
            selectedStars = Number(e.dataset.value);
            document
                .querySelectorAll(".star-item")
                .forEach(
                    (s) =>
                        (s.style.color =
                            Number(s.dataset.value) <= selectedStars ? "#f59e0b" : "#cbd5e1"),
                );
            setText("star-label", selectedStars + " de 5 estrellas");
            show("seccion-comentario", true);
        }),
    );
    on("btn-confirmar-calificacion", async () => {
        if (!selectedStars) throw new Error("Selecciona una puntuación.");
        const result = await api(`/sesiones/${selectedRating}/calificacion`, "POST", {
            estrellas: selectedStars,
            texto: $("calif-comentario-input").value,
        });
        show("modal-calificacion", false);
        await loadSessions();
        notify(repairMojibake(result.mensaje));
    });
    $("calif-comentario-input").addEventListener("input", () =>
        setText("calif-char-counter", $("calif-comentario-input").value.length + "/500"),
    );
    on("btn-chat-enviar", sendMessage);
    $("chat-search-input").addEventListener("input", renderConversations);
    on("btn-chat-action-more", openChatMenu);
    on("btn-chat-propose", proposeFromChat);
    on("chat-menu-propose", proposeFromChat);
    const viewChatPeer = async () => {
        hidePopoverSafe($("chat-peer-menu"));
        await otherProfile(chatPeerId());
    };
    on("chat-peer-profile", viewChatPeer);
    on("chat-menu-profile", viewChatPeer);
    $("chat-peer-profile").addEventListener("contextmenu", openChatMenu);
    $("chat-conversation-list").addEventListener("contextmenu", async (event) => {
        const peer = event.target.closest("[data-conversation]");
        if (!peer) return;
        event.preventDefault();
        const id = Number(peer.dataset.conversation),
            point = { clientX: event.clientX, clientY: event.clientY };
        try {
            await openConversation(id);
            if (selectedConversation?.id === id) openChatMenu(point);
        } catch (error) {
            notify(error.message, true);
        }
    });
    $("chat-peer-profile").addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            viewChatPeer().catch((e) => notify(e.message, true));
        }
    });
    $("chat-messages-container").addEventListener("contextmenu", (event) => {
        if (event.target.closest("[data-chat-peer]")) openChatMenu(event);
    });
    $("chat-messages-container").addEventListener("click", (event) => {
        if (event.target.closest("[data-chat-peer]"))
            viewChatPeer().catch((e) => notify(e.message, true));
    });
    $("chat-messages-container").addEventListener("keydown", (event) => {
        if (
            event.target.closest("[data-chat-peer]") &&
            (event.key === "Enter" || event.key === " ")
        ) {
            event.preventDefault();
            viewChatPeer().catch((e) => notify(e.message, true));
        }
    });

    for (const [button, input] of [
        ["btn-chat-attach", "chat-file-upload"],
        ["btn-chat-image", "chat-image-upload"],
    ]) {
        on(button, () => {
            if (!selectedConversation) throw new Error("Selecciona una conversación.");
            $(input).click();
        });
        on(
            input,
            async () => {
                const file = $(input).files[0];
                if (!file) return;
                if (!selectedConversation) throw new Error("Selecciona una conversación.");
                const data = new FormData();
                data.append("archivo", file);
                await api(`/conversaciones/${selectedConversation.id}/archivos`, "POST", data);
                $(input).value = "";
                await loadMessages();
                notify("Archivo enviado a la conversación.");
            },
            "change",
        );
    }
    const planTabs = [
        ["tab-btn-mi-plan", "tab-content-mi-plan"],
        ["tab-btn-gestion-sub", "tab-content-gestion-sub"],
        ["tab-btn-comprobantes", "tab-content-comprobantes"],
    ];

    function paintPlanTab(activeBtnId) {
        for (const [btnId, contentId] of planTabs) {
            const btn = $(btnId);
            const content = $(contentId);
            const isActive = btnId === activeBtnId;

            if (content) {
                content.style.display = isActive ? "block" : "none";
            }
            if (btn) {
                btn.classList.toggle("active", isActive);
                btn.setAttribute("aria-selected", String(isActive));
                if (isActive) {
                    btn.style.setProperty("color", "#b30832", "important");
                    btn.style.setProperty("border-bottom", "2px solid #b30832", "important");
                    btn.style.setProperty("font-weight", "600", "important");
                } else {
                    btn.style.removeProperty("color");
                    btn.style.removeProperty("border-bottom");
                    btn.style.removeProperty("font-weight");
                }
            }
        }
    }

    for (const [btnId] of planTabs) {
        const btn = $(btnId);
        if (!btn) continue;
        btn.addEventListener(
            "click",
            () => {
                paintPlanTab(btnId);
                setTimeout(() => paintPlanTab(btnId), 0);
            },
            true,
        );
    }

    paintPlanTab("tab-btn-mi-plan");
    for (const id of ["btn-ir-mi-suscripcion", "btn-rf38-banner-renovar"])
        on(id, () => navigate("suscripcion-section"));
    on("btn-mi-plan-aprovechar", () => navigate("buscar-section"));
    on("btn-contratar-plan-oficial", () => {
        const paid = plans.find((p) => Number(p.precio) > 0 && /semestr|ciclo|seman/i.test(p.periodo)) || plans.find((p) => Number(p.precio) > 0);
        if (!paid) throw new Error("Todavía no hay planes disponibles.");
        openPlan(paid.id);
    });
    on("btn-rf37-cancelar-suscripcion", async () => {
        const active = subscriptions.find((s) => ["ACTIVO", "TRIAL"].includes(s.estado_actual));
        if (!active) throw new Error("No tienes una suscripción activa.");
        if (
            await appDialog({
                title: "Cancelar suscripción",
                description: "Volverás al Plan Gratuito (modelo Freemium). Tu historial se conserva.",
                confirm: "Cancelar suscripción",
            })
        ) {
            await api(`/suscripciones/${active.id}/cancelar`, "POST");
            await loadSubscriptions();
            notify("Suscripción cancelada.");
        }
    });
    on("btn-activar-prueba-real", async () => {
        if (!selectedPlan) throw new Error("Selecciona un plan.");
        await api("/suscripciones/prueba", "POST", { plan_id: selectedPlan.id });
        show("modal-contratacion-plan", false);
        await loadSubscriptions();
        notify("Prueba gratuita activada.");
    });
    on("btn-confirmar-plan-real", openDemoPayment);
    on("btn-cancelar-oferta", () => show("modal-contratacion-plan", false));
    on("radio-modalidad-mensual", updatePaymentMode, "change");
    on("radio-modalidad-semestral", updatePaymentMode, "change");
    for (const field of ["rf36-input-tarjeta", "rf36-input-vence", "rf36-input-cvv", "rf36-input-titular"])
        on(field, event => { if (event.key === "Enter") { event.preventDefault(); return paymentDemo(); } }, "keydown");
    on("btn-descargar-boleta-pdf", () => {
        if (!lastDemoPayment) throw new Error("No hay un comprobante de esta simulación.");
        return downloadDocument(`/api/pagos/${lastDemoPayment}/comprobante/pdf`, "Comprobante_DEMO_StudyMatch.pdf");
    });
    on("btn-confirmar-pago-pasarela", () => paymentDemo());
    on("btn-rf36-sim-exito", () => paymentDemo("APROBADO"));
    on("btn-rf36-sim-rechazo", () => paymentDemo("RECHAZADO"));
    on("btn-rf36-sim-timeout", () => paymentDemo("TIMEOUT"));
    on("btn-cerrar-pasarela-x", () => show("modal-pasarela-pago", false));
    on("btn-cancelar-pasarela-link", () => show("modal-pasarela-pago", false));
    on("btn-cerrar-modal-exito-inicio", () => {
        show("modal-pago-exito", false);
        navigate("inicio-section");
    });
    on("btn-cerrar-contratacion-x", () => show("modal-contratacion-plan", false));
    on("rf38-btn-campana-dashboard", () => navigate("notificaciones-section"));
    on("btn-rf38-banner-ver-popup", () => navigate("suscripcion-section"));
    on("btn-rf38-banner-cerrar", () => show("rf38-banner-amarillo-dashboard", false));
    on("select-filtro-curso-reporte", reports, "change");
    on("btn-descargar-reporte-pdf", () => {
        const materia=$("select-filtro-curso-reporte").value;
        return downloadDocument("/api/perfil/reporte/pdf"+(materia?"?materia="+encodeURIComponent(materia):""),"Reporte_StudyMatch.pdf");
    });
    document.addEventListener(
        "click",
        handle(async (event) => {
            const el = event.target.closest(
                "[data-remove-subject],[data-remove-document],[data-student],[data-conversation],[data-session-action],[data-read],[data-go-sessions],[data-slot],[data-plan],[data-receipt]",
            );
            if (!el) return;
            const actionBtn = el.tagName === "BUTTON" ? el : el.closest("button");
            const prevDisabled = actionBtn ? actionBtn.disabled : false;
            if (prevDisabled) return;
            if (actionBtn) actionBtn.disabled = true;
            try {
                if (el.dataset.removeSubject) {
                    await api("/perfil/materias/" + el.dataset.removeSubject, "DELETE");
                    await loadMySubjects();
                } else if (el.dataset.removeDocument) {
                    if (
                        await appDialog({
                            title: "Eliminar documento",
                            description: "¿Quieres eliminar este documento de tu perfil?",
                            confirm: "Eliminar documento",
                        })
                    ) {
                        await api("/documentos/" + el.dataset.removeDocument, "DELETE");
                        await loadDocuments();
                    }
                } else if (el.dataset.student) await otherProfile(el.dataset.student);
                else if (el.dataset.conversation) await openConversation(el.dataset.conversation);
                else if (el.dataset.read) {
                    await api("/notificaciones/" + el.dataset.read + "/leer", "POST");
                    await loadNotifications();
                } else if (el.hasAttribute("data-go-sessions")) await navigate("mis-sesiones-section");
                else if (el.dataset.slot) {
                    selectedSlots.has(el.dataset.slot)
                        ? selectedSlots.delete(el.dataset.slot)
                        : selectedSlots.add(el.dataset.slot);
                    drawSchedule();
                } else if (el.dataset.plan) openPlan(el.dataset.plan);
                else if (el.dataset.receipt) {
                    await downloadDocument("/api/pagos/"+el.dataset.receipt+"/comprobante/pdf","Comprobante_StudyMatch.pdf");
                } else if (el.dataset.sessionAction) {
                    const id = Number(el.dataset.session),
                        action = el.dataset.sessionAction,
                        row = sessions.find((s) => s.id === id);
                    if (action === "reprogramar") {
                        await openRescheduleModal(id);
                        return;
                    }
                    if (action === "calificar") {
                        selectedRating = id;
                        selectedStars = 0;
                        setText("calif-nombre-companero", row.companero);
                        $("calif-comentario-input").value = row.comentario || "";
                        show("seccion-comentario", true);
                        show("modal-calificacion", true, "flex");
                        document
                            .querySelectorAll(".star-item")
                            .forEach((s) => (s.style.color = "#cbd5e1"));
                        setText("star-label", "Selecciona una puntuación");
                        return;
                    }
                    if (action === "cancelar") {
                        selectedCancellation = id;
                        show("modal-cancelacion", true, "flex");
                        return;
                    }
                    if (action === "iniciar") {
                        const windowStatus = getMeetingWindowStatus(row);
                        if (!windowStatus.canJoin) {
                            notify("Podrás iniciar la reunión desde 30 minutos antes.", true);
                            return;
                        }
                    }
                    const data = {};
                    if (action === "enlace") {
                        const link = await appDialog({
                            title: "Añadir enlace",
                            description:
                                "Pega el enlace de tu reunión de Zoom, Meet u otra plataforma.",
                            link: true,
                            value: row.enlace_videollamada || "",
                            confirm: "Guardar enlace",
                        });
                        if (!link) return;
                        data.enlace = link;
                    }
                    let updated;
                    try { updated=await api(`/sesiones/${id}/${action}`,"POST",data); }
                    catch(error){
                        if(action!=="finalizar" || !error.message.includes("menor de cinco minutos"))throw error;
                        if(!await appDialog({title:"Sesión breve",description:"La duración es menor de cinco minutos. ¿Confirmas la finalización?",confirm:"Confirmar finalización"}))return;
                        updated=await api(`/sesiones/${id}/${action}`,"POST",{confirmar_duracion_corta:true});
                    }
                    if (action === "iniciar") {
                        const targetUrl = updated?.enlace_videollamada || row?.enlace_videollamada;
                        if (!targetUrl?.startsWith("https://")) {
                            throw new Error("El enlace de videollamada no es válido.");
                        }
                        const nuevaPestana = window.open(targetUrl, "_blank", "noopener,noreferrer");
                        if (!nuevaPestana) {
                            notify(
                                "El navegador bloqueó la pestaña nueva. Permite ventanas emergentes para abrir la clase sin salir de tu página.",
                                true,
                            );
                        }
                        return;
                    }
                    await loadSessions();
                    await loadHours();
                    await loadBadges();
                    notify(
                        action === "finalizar"
                            ? "Confirmación guardada. La sesión termina cuando ambos confirman."
                            : "Cambio guardado.",
                    );
                }
            } finally {
                if (actionBtn && actionBtn.isConnected) actionBtn.disabled = prevDisabled;
            }
        }),
    );
    // Restaurar una sesión solo si el servidor la reconoce. Nunca usar un usuario por defecto.
    try {
        await token();
        await loadCatalogs();
        const reset = new URLSearchParams(location.search).get("reset");
        if (reset) {
            authPage("reset-section");
            return;
        }
        const pending = await api("/auth/verificacion");
        if (pending.requiere_verificacion) {
            await signedIn(pending);
            return;
        }
        const user = await api("/auth/yo");
        await signedIn({ estudiante: user, csrf });
    } catch (error) {
        loggedOut();
        if (error.message !== "Inicia sesión para continuar.") notify(error.message, true);
    } finally {
        $("btn-login").disabled = false;
    }
});

// Descarga real. El selector nativo permite distinguir guardar y cancelar cuando está disponible.
async function downloadDocument(url,nombre){
    const respuesta=await fetch(url,{credentials:"same-origin"});
    if(!respuesta.ok){let dato;try{dato=await respuesta.json();}catch{}throw new Error(dato?.error||"No se pudo descargar el documento.");}
    const archivo=await respuesta.blob();
    if(window.showSaveFilePicker){
        try{
            const destino=await window.showSaveFilePicker({suggestedName:nombre,types:[{description:"Documento PDF",accept:{"application/pdf":[".pdf"]}}]});
            const escritura=await destino.createWritable();await escritura.write(archivo);await escritura.close();notify("Descarga exitosa.");
        }catch(error){if(error.name!=="AbortError")throw error;notify("Descarga cancelada.");}
    }else{
        const enlace=document.createElement("a");enlace.href=URL.createObjectURL(archivo);enlace.download=nombre;enlace.click();
        setTimeout(()=>URL.revokeObjectURL(enlace.href),30000);notify("Descarga iniciada.");
    }
}