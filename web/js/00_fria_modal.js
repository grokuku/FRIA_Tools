/**
 * FR.IA Modal — Fonction de modale partagée par toutes les extensions FR.IA.
 *
 * Fichier préfixé 00_ pour garantir le chargement avant tous les autres fria_*.js.
 * Attache friaOpenModal à window explicitement.
 *
 * Usage :
 *   var m = friaOpenModal("Titre", "<p>HTML</p>", "440px");
 *   m.body.innerHTML = "...";  // modifier le contenu
 *   m.close();                 // fermer
 */
window.friaOpenModal = function (title, contentHtml, width) {
    var modal = document.createElement("div");
    Object.assign(modal.style, {
        position: "fixed",
        background: "#2a2a2e",
        borderRadius: "12px",
        boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
        width: (width || "440px"),
        maxHeight: "80vh",
        zIndex: "99999",
    });

    // Header draggable
    var header = document.createElement("div");
    Object.assign(header.style, {
        display: "flex", alignItems: "center", justifyContent: "space-between",
        padding: "10px 16px", cursor: "grab", userSelect: "none",
        borderBottom: "1px solid #444",
    });
    header.onmouseenter = function () { header.style.cursor = "grab"; };

    var titleEl = document.createElement("span");
    titleEl.textContent = title;
    Object.assign(titleEl.style, { fontSize: "14px", fontWeight: "600", color: "#fff" });

    var closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    Object.assign(closeBtn.style, {
        background: "none", border: "none", color: "#999", cursor: "pointer",
        fontSize: "16px", padding: "0 4px",
    });
    closeBtn.onmouseenter = function () { closeBtn.style.color = "#f87171"; };
    closeBtn.onmouseleave = function () { closeBtn.style.color = "#999"; };
    closeBtn.onclick = function () { modal.remove(); };

    header.appendChild(titleEl);
    header.appendChild(closeBtn);

    // Body
    var body = document.createElement("div");
    Object.assign(body.style, {
        padding: "16px", overflowY: "auto", maxHeight: "calc(80vh - 48px)",
    });
    if (typeof contentHtml === "string") {
        body.innerHTML = contentHtml;
    } else if (contentHtml) {
        body.appendChild(contentHtml);
    }

    modal.appendChild(header);
    modal.appendChild(body);
    document.body.appendChild(modal);

    // Centrer
    modal.style.left = Math.max(100, (window.innerWidth - parseInt(width || "440")) / 2) + "px";
    modal.style.top = Math.max(50, (window.innerHeight * 0.1)) + "px";

    // Drag
    var drag = { active: false, startX: 0, startY: 0, origX: 0, origY: 0 };
    header.addEventListener("mousedown", function (e) {
        if (e.target === closeBtn) return;
        drag.active = true;
        var rect = modal.getBoundingClientRect();
        drag.startX = e.clientX;
        drag.startY = e.clientY;
        drag.origX = rect.left;
        drag.origY = rect.top;
        header.style.cursor = "grabbing";
        e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
        if (!drag.active) return;
        modal.style.left = (drag.origX + e.clientX - drag.startX) + "px";
        modal.style.top = (drag.origY + e.clientY - drag.startY) + "px";
    });
    document.addEventListener("mouseup", function () {
        if (drag.active) { drag.active = false; header.style.cursor = "grab"; }
    });

    return { modal: modal, body: body, close: function () { modal.remove(); } };
};