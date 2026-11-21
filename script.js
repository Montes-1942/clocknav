
"use strict";

/* =========================================
   CONFIGURACIÓN GENERAL
========================================= */

const MAX_IMAGES = 10;
const SLIDE_DURATION = 5000;

const DB_NAME = "MiPaginaInicioDB";
const DB_VERSION = 1;
const STORE_NAME = "photos";

const COLORS_STORAGE_KEY = "miPaginaColores";

const DEFAULT_COLORS = {
    page: "#0a0f1c",
    gallery: "#17243a",
    clock: "#17243a"
};

/* =========================================
   ESTADO DE LA APLICACIÓN
========================================= */

let db = null;
let photos = [];
let currentSlide = 0;
let sliderInterval = null;
let objectUrls = [];

/* =========================================
   ELEMENTOS HTML
========================================= */

const $ = (id) => document.getElementById(id);

const elements = {
    time: $("time"),
    date: $("date"),
    city: $("city"),

    searchForm: $("searchForm"),
    searchInput: $("searchInput"),

    imageUpload: $("imageUpload"),
    slides: $("slides"),
    dots: $("sliderDots"),

    previous: $("prevSlide"),
    next: $("nextSlide"),
    counter: $("slideCounter"),
    uploadStatus: $("uploadStatus"),

    settingsToggle: $("settingsToggle"),
    settingsPanel: $("settingsPanel"),
    closeSettings: $("closeSettings"),

    pageColor: $("pageColor"),
    galleryColor: $("galleryColor"),
    clockColor: $("clockColor"),
    resetColors: $("resetColors")
};

/* =========================================
   COMPROBACIÓN DE ELEMENTOS
========================================= */

function checkRequiredElements() {
    const missing = Object.entries(elements)
        .filter(([, element]) => !element)
        .map(([name]) => name);

    if (missing.length > 0) {
        console.error(
            "Faltan elementos HTML necesarios:",
            missing.join(", ")
        );
        return false;
    }

    return true;
}

/* =========================================
   RELOJ DIGITAL
========================================= */

function getTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ||
        "America/Bogota";
}

function getLocationLabel(timezone) {
    const locationNames = {
        "America/Bogota": "Santa Marta, Colombia",
        "America/Mexico_City": "Ciudad de México",
        "America/Lima": "Lima, Perú",
        "America/Caracas": "Caracas, Venezuela",
        "America/Santiago": "Santiago, Chile",
        "America/Guayaquil": "Quito, Ecuador",
        "America/Argentina/Buenos_Aires": "Buenos Aires, Argentina",
        "America/New_York": "Nueva York, Estados Unidos",
        "America/Los_Angeles": "Los Ángeles, Estados Unidos",
        "Europe/Madrid": "Madrid, España",
        "Europe/London": "Londres, Reino Unido",
        "Asia/Tokyo": "Tokio, Japón"
    };

    return locationNames[timezone] ||
        timezone.replaceAll("_", " ").replaceAll("/", " · ");
}

function updateClock() {
    const timezone = getTimezone();
    const now = new Date();

    try {
        const timeText = new Intl.DateTimeFormat("es-CO", {
            timeZone: timezone,
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        }).format(now);

        const dateText = new Intl.DateTimeFormat("es-CO", {
            timeZone: timezone,
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        }).format(now);

        elements.time.textContent = timeText;
        elements.date.textContent = dateText;
        elements.city.textContent = getLocationLabel(timezone);

    } catch (error) {
        console.error("Error al actualizar el reloj:", error);

        // Respaldo: hora local del dispositivo
        elements.time.textContent = new Intl.DateTimeFormat("es-CO", {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hourCycle: "h23"
        }).format(now);

        elements.date.textContent = new Intl.DateTimeFormat("es-CO", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric"
        }).format(now);

        elements.city.textContent = "Hora local del dispositivo";
    }
}

function startClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

/* =========================================
   BUSCADOR GOOGLE
========================================= */

function initializeSearch() {
    elements.searchForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const query = elements.searchInput.value.trim();

        if (!query) return;

        const url =
            "https://www.google.com/search?q=" +
            encodeURIComponent(query);

        window.open(url, "_blank", "noopener,noreferrer");
    });
}

/* =========================================
   BASE DE DATOS INDEXEDDB
========================================= */

function openDatabase() {
    return new Promise((resolve, reject) => {
        if (!("indexedDB" in window)) {
            reject(new Error("IndexedDB no está disponible."));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, {
                    keyPath: "id",
                    autoIncrement: true
                });
            }
        };

        request.onsuccess = () => {
            db = request.result;

            db.onversionchange = () => {
                db.close();
            };

            resolve(db);
        };

        request.onerror = () => {
            reject(request.error);
        };

        request.onblocked = () => {
            console.warn(
                "La base de datos está bloqueada por otra pestaña."
            );
        };
    });
}

function savePhoto(file) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const store = transaction.objectStore(STORE_NAME);

        const request = store.add({
            name: file.name,
            type: file.type,
            blob: file,
            dateAdded: new Date().toISOString()
        });

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function getPhotos() {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readonly");
        const request = transaction.objectStore(STORE_NAME).getAll();

        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error);
    });
}

function deletePhoto(id) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_NAME, "readwrite");
        const request = transaction.objectStore(STORE_NAME).delete(id);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

/* =========================================
   SUBIR FOTOGRAFÍAS
========================================= */

function initializeUpload() {
    elements.imageUpload.addEventListener("change", async (event) => {
        const selectedFiles = Array.from(event.target.files || []);

        if (selectedFiles.length === 0) return;

        if (!db) {
            elements.uploadStatus.textContent =
                "La galería todavía no está disponible.";
            elements.imageUpload.value = "";
            return;
        }

        elements.uploadStatus.textContent = "Cargando fotografías...";

        try {
            const currentPhotos = await getPhotos();
            const freeSlots = MAX_IMAGES - currentPhotos.length;

            if (freeSlots <= 0) {
                elements.uploadStatus.textContent =
                    "Galería completa (10/10).";
                return;
            }

            let added = 0;
            let rejected = 0;

            for (const file of selectedFiles) {
                if (added >= freeSlots) {
                    rejected++;
                    continue;
                }

                const allowedTypes = [
                    "image/jpeg",
                    "image/png",
                    "image/webp"
                ];

                if (!allowedTypes.includes(file.type)) {
                    rejected++;
                    continue;
                }

                try {
                    await savePhoto(file);
                    added++;
                } catch (error) {
                    console.error("No se pudo guardar:", file.name, error);
                    rejected++;
                }
            }

            if (added > 0) {
                // Ir a la primera de las nuevas fotografías
                currentSlide = currentPhotos.length;
            }

            await renderGallery();

            if (added && rejected === 0) {
                elements.uploadStatus.textContent =
                    `${added} fotografía(s) agregada(s).`;
            } else if (added && rejected > 0) {
                elements.uploadStatus.textContent =
                    `${added} agregada(s). ${rejected} omitida(s).`;
            } else {
                elements.uploadStatus.textContent =
                    "No se agregaron fotografías válidas.";
            }

        } catch (error) {
            console.error("Error al subir fotografías:", error);
            elements.uploadStatus.textContent =
                "No fue posible cargar las fotografías.";
        } finally {
            // Permite seleccionar nuevamente el mismo archivo
            elements.imageUpload.value = "";
        }
    });
}

/* =========================================
   MOSTRAR GALERÍA
========================================= */

async function renderGallery() {
    stopSlider();
    releaseObjectUrls();

    photos = await getPhotos();

    elements.slides.innerHTML = "";
    elements.dots.innerHTML = "";

    const hasPhotos = photos.length > 0;
    const canNavigate = photos.length > 1;

    elements.previous.hidden = !canNavigate;
    elements.next.hidden = !canNavigate;
    elements.counter.hidden = !hasPhotos;

    if (!hasPhotos) {
        currentSlide = 0;

        const empty = document.createElement("div");
        empty.className = "empty-gallery";

        empty.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3" y="3" width="18" height="18" rx="3"></rect>
                <circle cx="8.5" cy="8.5" r="1.5"></circle>
                <path d="m21 15-5-5L5 21"></path>
            </svg>
            <p>Tu galería está vacía</p>
        `;

        elements.slides.appendChild(empty);
        updateCounter();
        return;
    }

    currentSlide = Math.max(
        0,
        Math.min(currentSlide, photos.length - 1)
    );

    photos.forEach((photo, index) => {
        const slide = document.createElement("div");
        slide.className = "slide";

        if (index === currentSlide) {
            slide.classList.add("active");
        }

        const image = document.createElement("img");
        const imageUrl = URL.createObjectURL(photo.blob);

        objectUrls.push(imageUrl);

        image.src = imageUrl;
        image.alt = photo.name || `Fotografía ${index + 1}`;
        image.loading = index === currentSlide ? "eager" : "lazy";

        slide.appendChild(image);

        // Botón para eliminar la fotografía
        const deleteButton = document.createElement("button");
        deleteButton.type = "button";
        deleteButton.className = "delete-photo";
        deleteButton.title = "Eliminar fotografía";
        deleteButton.setAttribute("aria-label", "Eliminar fotografía");

        deleteButton.innerHTML = `
            <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 7h16"></path>
                <path d="M10 11v6"></path>
                <path d="M14 11v6"></path>
                <path d="m5 7 1 13h12l1-13"></path>
                <path d="M9 7V4h6v3"></path>
            </svg>
        `;

        deleteButton.addEventListener("click", () => {
            removePhoto(photo.id);
        });

        slide.appendChild(deleteButton);
        elements.slides.appendChild(slide);

        // Indicadores inferiores
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className = "slider-dot";
        dot.title = `Ver fotografía ${index + 1}`;
        dot.setAttribute("aria-label", `Ver fotografía ${index + 1}`);

        if (index === currentSlide) {
            dot.classList.add("active");
        }

        dot.addEventListener("click", () => {
            showSlide(index);
            restartSlider();
        });

        elements.dots.appendChild(dot);
    });

    updateCounter();
    startSlider();
}

/* =========================================
   LIBERAR IMÁGENES DE MEMORIA
========================================= */

function releaseObjectUrls() {
    objectUrls.forEach((url) => {
        URL.revokeObjectURL(url);
    });

    objectUrls = [];
}

/* =========================================
   ELIMINAR FOTOGRAFÍAS
========================================= */

async function removePhoto(id) {
    try {
        const activePhotoId = photos[currentSlide]?.id;
        const deletedIndex = photos.findIndex(photo => photo.id === id);

        if (deletedIndex === -1) return;

        await deletePhoto(id);

        const updatedPhotos = await getPhotos();

        const activeIndex = updatedPhotos.findIndex(
            photo => photo.id === activePhotoId
        );

        if (activeIndex !== -1) {
            currentSlide = activeIndex;
        } else {
            currentSlide = Math.min(
                deletedIndex,
                updatedPhotos.length - 1
            );
        }

        currentSlide = Math.max(0, currentSlide);

        await renderGallery();

        elements.uploadStatus.textContent =
            "Fotografía eliminada correctamente.";

    } catch (error) {
        console.error("Error al eliminar fotografía:", error);
        elements.uploadStatus.textContent =
            "No fue posible eliminar la fotografía.";
    }
}

/* =========================================
   CONTADOR
========================================= */

function updateCounter() {
    if (photos.length === 0) {
        elements.counter.hidden = true;
        elements.counter.textContent = "";
        return;
    }

    elements.counter.hidden = false;
    elements.counter.textContent =
        `${currentSlide + 1}/${MAX_IMAGES}`;
}

/* =========================================
   NAVEGACIÓN DE FOTOGRAFÍAS
========================================= */

function showSlide(index) {
    if (photos.length === 0) return;

    currentSlide = (index + photos.length) % photos.length;

    const slides = elements.slides.querySelectorAll(".slide");
    const dots = elements.dots.querySelectorAll(".slider-dot");

    slides.forEach((slide, position) => {
        slide.classList.toggle("active", position === currentSlide);
    });

    dots.forEach((dot, position) => {
        dot.classList.toggle("active", position === currentSlide);
    });

    updateCounter();
}

function nextSlide() {
    showSlide(currentSlide + 1);
}

function previousSlide() {
    showSlide(currentSlide - 1);
}

elements.next.addEventListener("click", () => {
    nextSlide();
    restartSlider();
});

elements.previous.addEventListener("click", () => {
    previousSlide();
    restartSlider();
});

/* =========================================
   REPRODUCCIÓN AUTOMÁTICA
========================================= */

function startSlider() {
    stopSlider();

    const reduceMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)"
    ).matches;

    if (photos.length > 1 && !reduceMotion) {
        sliderInterval = setInterval(nextSlide, SLIDE_DURATION);
    }
}

function stopSlider() {
    if (sliderInterval !== null) {
        clearInterval(sliderInterval);
        sliderInterval = null;
    }
}

function restartSlider() {
    startSlider();
}

/* =========================================
   PANEL DE CONFIGURACIÓN
========================================= */

function openSettings() {
    elements.settingsPanel.hidden = false;
    elements.settingsToggle.setAttribute("aria-expanded", "true");
}

function closeSettingsPanel() {
    elements.settingsPanel.hidden = true;
    elements.settingsToggle.setAttribute("aria-expanded", "false");
}

elements.settingsToggle.addEventListener("click", () => {
    if (elements.settingsPanel.hidden) {
        openSettings();
    } else {
        closeSettingsPanel();
    }
});

elements.closeSettings.addEventListener("click", closeSettingsPanel);

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeSettingsPanel();
    }
});

document.addEventListener("click", (event) => {
    const insidePanel = elements.settingsPanel.contains(event.target);
    const onToggle = elements.settingsToggle.contains(event.target);

    if (!insidePanel && !onToggle && !elements.settingsPanel.hidden) {
        closeSettingsPanel();
    }
});

/* =========================================
   SISTEMA DE COLORES
========================================= */

function applyColors(colors) {
    document.documentElement.style.setProperty(
        "--page-bg",
        colors.page
    );

    document.documentElement.style.setProperty(
        "--gallery-bg",
        colors.gallery
    );

    document.documentElement.style.setProperty(
        "--clock-bg",
        colors.clock
    );

    elements.pageColor.value = colors.page;
    elements.galleryColor.value = colors.gallery;
    elements.clockColor.value = colors.clock;
}

function getSelectedColors() {
    return {
        page: elements.pageColor.value,
        gallery: elements.galleryColor.value,
        clock: elements.clockColor.value
    };
}

function saveColors() {
    try {
        localStorage.setItem(
            COLORS_STORAGE_KEY,
            JSON.stringify(getSelectedColors())
        );
    } catch (error) {
        console.error("No se pudieron guardar los colores:", error);
    }
}

function loadColors() {
    let savedColors = null;

    try {
        const stored = localStorage.getItem(COLORS_STORAGE_KEY);

        if (stored) {
            savedColors = JSON.parse(stored);
        }
    } catch (error) {
        console.warn("Se utilizarán los colores predeterminados.", error);
    }

    const colors = {
        page: isValidColor(savedColors?.page)
            ? savedColors.page
            : DEFAULT_COLORS.page,

        gallery: isValidColor(savedColors?.gallery)
            ? savedColors.gallery
            : DEFAULT_COLORS.gallery,

        clock: isValidColor(savedColors?.clock)
            ? savedColors.clock
            : DEFAULT_COLORS.clock
    };

    applyColors(colors);
}

function isValidColor(value) {
    return typeof value === "string" &&
        /^#[0-9a-fA-F]{6}$/.test(value);
}

function handleColorChange() {
    applyColors(getSelectedColors());
    saveColors();
}

function initializeColors() {
    loadColors();

    elements.pageColor.addEventListener("input", handleColorChange);
    elements.galleryColor.addEventListener("input", handleColorChange);
    elements.clockColor.addEventListener("input", handleColorChange);

    // Respaldo para navegadores que aplican el color al cerrar el selector
    elements.pageColor.addEventListener("change", handleColorChange);
    elements.galleryColor.addEventListener("change", handleColorChange);
    elements.clockColor.addEventListener("change", handleColorChange);

    elements.resetColors.addEventListener("click", () => {
        applyColors(DEFAULT_COLORS);
        saveColors();
    });
}

/* =========================================
   INICIAR APLICACIÓN
========================================= */

async function initializeApp() {
    if (!checkRequiredElements()) {
        return;
    }

    // El reloj y los colores funcionan independientemente
    startClock();
    initializeSearch();
    initializeColors();

    // Inicializar controles de configuración
    initializeUpload();

    // Inicializar almacenamiento y galería
    try {
        await openDatabase();
        await renderGallery();
    } catch (error) {
        console.error("Error al iniciar la galería:", error);

        elements.uploadStatus.textContent =
            "No se pudo iniciar el almacenamiento de fotografías.";
    }
}

initializeApp();
