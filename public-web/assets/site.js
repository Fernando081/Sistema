// Mejora progresiva de la web pública (WEB02.5). Todo el contenido existe en el HTML
// inicial; este archivo solo agrega movimiento, controles del carrusel y la vista previa
// de la etiqueta de consulta. Si falla o no se carga, la página queda completa.
(() => {
  const root = document.documentElement;
  const still = matchMedia("(prefers-reduced-motion: reduce)");
  root.classList.add("js");

  // Entradas por sección: título, texto y luego imagen, una sola vez. En páginas
  // interiores (pantallas de trabajo) solo entran títulos e imágenes sueltos; formularios,
  // resultados y listados aparecen sin movimiento.
  if (!document.querySelector(".hero"))
    for (const element of document.querySelectorAll(
      "main h2, main .image-frame, main .product-gallery figure",
    ))
      if (
        !element.closest(
          ".page-heading, form, .product-card, .inquiry-summary, [role=search]",
        )
      )
        element.setAttribute("data-reveal-self", "");
  const groups = document.querySelectorAll("[data-reveal], [data-reveal-self]");
  if ("IntersectionObserver" in window && !still.matches) {
    root.classList.add("reveal-ready");
    let answered = false;
    const seen = new IntersectionObserver(
      (entries) => {
        answered = true;
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          seen.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    for (const group of groups) {
      seen.observe(group);
      // Al terminar la entrada se libera el recorte (focos y bordes que sobresalen).
      group.addEventListener("transitionend", (event) => {
        if (event.propertyName !== "clip-path") return;
        if (event.target === group || event.target.parentElement === group)
          event.target.classList.add("revealed");
      });
    }
    // Respaldo solo si el observador nunca respondió: nada queda oculto.
    setTimeout(() => {
      if (answered) return;
      seen.disconnect();
      root.classList.remove("reveal-ready");
    }, 4000);
  }

  // Fotografía de portada: deriva ligada al scroll. Con animation-timeline la hace el
  // CSS; aquí solo el respaldo, que deja de escribir al salir de la portada.
  const drift = document.querySelector("[data-drift]");
  if (
    drift &&
    !still.matches &&
    !CSS.supports?.("animation-timeline: scroll()")
  ) {
    let queued = false;
    let last = -1;
    const move = () => {
      queued = false;
      const y = Math.round(Math.min(scrollY, innerHeight) * 0.18);
      if (y === last) return;
      last = y;
      drift.style.translate = `0 ${y}px`;
    };
    addEventListener(
      "scroll",
      () => {
        if (!queued) {
          queued = true;
          requestAnimationFrame(move);
        }
      },
      { passive: true },
    );
    move();
  }

  // Carrusel de pasos: botones y barra de avance sobre el desplazamiento nativo.
  const row = document.querySelector("[data-steps-row]");
  if (row) {
    const bar = document.querySelector("[data-steps-progress]");
    const controls = document.querySelector("[data-steps-controls]");
    const update = () => {
      const max = row.scrollWidth - row.clientWidth;
      const share = max > 0 ? row.clientWidth / row.scrollWidth : 1;
      const done = max > 0 ? row.scrollLeft / max : 0;
      // Sin desbordamiento (escritorio ancho) la fila se ve completa: sin barra ni botones.
      const scrollable = max > 4;
      if (bar) {
        bar.parentElement.hidden = !scrollable;
        bar.style.width = `${share * 100}%`;
        bar.style.transform = `translateX(${(done * (1 - share) * 100) / share}%)`;
      }
      if (controls) controls.hidden = !scrollable;
      if (controls && scrollable) {
        controls.querySelector('[data-steps="-1"]').disabled = row.scrollLeft < 4;
        controls.querySelector('[data-steps="1"]').disabled = row.scrollLeft > max - 4;
      }
    };
    if (controls) {
      controls.addEventListener("click", (event) => {
        const button = event.target.closest("[data-steps]");
        if (!button) return;
        const step = row.querySelector("li")?.getBoundingClientRect().width ?? 300;
        row.scrollBy({
          left: Number(button.dataset.steps) * (step + 32),
          behavior: still.matches ? "auto" : "smooth",
        });
      });
    }
    row.addEventListener("scroll", update, { passive: true });
    addEventListener("resize", update);
    update();
  }

  // Etiqueta de consulta: vista previa del mensaje y enlace directo a WhatsApp.
  // El texto coincide con el que prepara /consulta en el servidor.
  const tag = document.querySelector("[data-tag]");
  if (tag) {
    const preview = tag.querySelector("[data-tag-preview]");
    const whatsapp = tag.querySelector("[data-tag-whatsapp]");
    const value = (name) => tag.elements[name].value.trim();
    const render = () => {
      const part = value("parte");
      const amount = value("cantidad") || "1";
      const valid = part && /^[1-9]\d{0,3}$/.test(amount);
      const message = `Hola, quisiera consultar una refacción.\nNúmero de parte indicado: ${part}\nMarca indicada: ${value("marca") || "Por confirmar"}\nAplicación indicada: ${value("aplicacion") || "Por confirmar"}\nCantidad: ${amount}\nPor favor, confirmar identificación, compatibilidad, disponibilidad y precio.`;
      preview.textContent = valid ? message : preview.dataset.empty;
      tag.classList.toggle("is-filled", Boolean(valid));
      if (whatsapp) {
        whatsapp.hidden = !valid;
        if (valid)
          whatsapp.href = `https://wa.me/${whatsapp.dataset.number}?text=${encodeURIComponent(message)}`;
      }
    };
    preview.dataset.empty = preview.textContent;
    tag.addEventListener("input", render);
    render();
  }
})();
