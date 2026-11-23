
"use strict";

/* ==========================================
   1. ELEMENTOS Y CONFIGURACIÓN
========================================== */

const $ = (id) => document.getElementById(id);

const el = {
    searchForm: $("searchForm"),
    searchInput: $("searchInput"),
    imageUpload: $("imageUpload"),
    slides: $("slides"),
    sliderDots: $("sliderDots"),
    prev: $("prevSlide"),
    next: $("nextSlide"),
    counter: $("slideCounter"),
    status: $("uploadStatus"),
    city: $("city"),
    time: $("time"),
    date: $("date"),
    weatherLocation: $("weatherLocation"),
    weatherCurrent: $("weatherCurrent"),
    forecastList: $("forecastList"),
    weatherNote: $("weatherNote"),
    refresh: $("refreshWeather"),
    themeLabel: $("themeLabel")
};

const MAX_PHOTOS = 10;
const SLIDE_INTERVAL = 5000;
const DB_NAME = "MiPaginaInicioDB";
const DB_VERSION = 1;
const STORE = "photos";

let db = null;
let photos = [];
let currentSlide = 0;
let objectUrls = [];
let slideTimer = null;
let userCoordinates = null;
let weatherBusy = false;

/* Ubicación alternativa */
const FALLBACK = {
    latitude: 11.2408,
    longitude: -74.1990,
    label: "Santa Marta, Colombia (referencia)"
};

/* ==========================================
   2. RELOJ LOCAL
========================================== */

function updateClock() {
    const now = new Date();

    el.time.textContent = new Intl.DateTimeFormat(undefined, {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
    }).format(now);

    el.date.textContent = new Intl.DateTimeFormat(undefined, {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric"
    }).format(now);

    // No inventamos la ciudad usando solamente la zona horaria.
}

function startClock() {
    updateClock();
    setInterval(updateClock, 1000);
}

/* ==========================================
   3. TEMA AUTOMÁTICO CLARO / OSCURO
========================================== */

function initTheme() {
    const preference = window.matchMedia("(prefers-color-scheme: dark)");

    function updateTheme() {
        el.themeLabel.textContent = preference.matches
            ? "Modo oscuro"
            : "Modo claro";

        const meta = document.querySelector('meta[name="theme-color"]');

        if (meta) {
            meta.content = preference.matches
                ? "#0c1220"
                : "#f1f3f6";
        }
    }

    updateTheme();

    if (preference.addEventListener) {
        preference.addEventListener("change", updateTheme);
    } else if (preference.addListener) {
        preference.addListener(updateTheme);
    }
}

/* ==========================================
   4. BUSCADOR GOOGLE
========================================== */

function initSearch() {
    el.searchForm.addEventListener("submit", (event) => {
        event.preventDefault();

        const query = el.searchInput.value.trim();

        if (!query) {
            el.searchInput.focus();
            return;
        }

        const googleUrl =
            "https://www.google.com/search?q=" +
            encodeURIComponent(query);

        window.open(googleUrl, "_blank", "noopener,noreferrer");
    });
}

/* ==========================================
   5. BASE DE DATOS DE FOTOGRAFÍAS
========================================== */

function openDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("IndexedDB no está disponible."));
            return;
        }

        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
            const database = event.target.result;

            if (!database.objectStoreNames.contains(STORE)) {
                database.createObjectStore(STORE, {
                    keyPath: "id",
                    autoIncrement: true
                });
            }
        };

        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };

        request.onerror = () => {
            reject(request.error || new Error("Error al abrir la base de datos."));
        };
    });
}

/* ERROR 1 CORREGIDO: función getPhotos() */

function getPhotos() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error("La base de datos no está inicializada."));
            return;
        }

        const request = db
            .transaction(STORE, "readonly")
            .objectStore(STORE)
            .getAll();

        request.onsuccess = () => {
            resolve(request.result || []);
        };

        request.onerror = () => {
            reject(request.error || new Error("No se pudieron leer las fotografías."));
        };
    });
}

function savePhoto(file) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE, "readwrite");
        const request = transaction.objectStore(STORE).add({
            name: file.name,
            blob: file,
            type: file.type,
            createdAt: Date.now()
        });

        request.onsuccess = () => resolve(request.result);

        request.onerror = () => {
            reject(request.error || new Error("No se pudo guardar la fotografía."));
        };
    });
}

/* ==========================================
   6. GALERÍA DE FOTOGRAFÍAS
========================================== */

function revokeUrls() {
    objectUrls.forEach((url) => URL.revokeObjectURL(url));
    objectUrls = [];
}

function renderGallery() {
    revokeUrls();

    el.slides.innerHTML = "";
    el.sliderDots.innerHTML = "";

    if (photos.length === 0) {
        el.slides.innerHTML = `
            <div class="empty-gallery">
                <div class="empty-icon">＋</div>
                <p>Tu galería está lista</p>
                <span>Agrega fotografías para iniciar</span>
            </div>
        `;

        el.prev.hidden = true;
        el.next.hidden = true;
        el.counter.hidden = true;
        el.status.textContent = "0/10 fotografías";

        stopSlideshow();
        return;
    }

    // Mantener índice dentro del rango de fotografías
    currentSlide = ((currentSlide % photos.length) + photos.length) % photos.length;

    photos.forEach((photo, index) => {
        const url = URL.createObjectURL(photo.blob);
        objectUrls.push(url);

        // Mostrar solamente la fotografía activa
        if (index === currentSlide) {
            const img = document.createElement("img");

            img.src = url;
            img.alt = photo.name || `Fotografía ${index + 1}`;
            img.className = "gallery-image";

            el.slides.appendChild(img);
        }

        // Crear indicador de posición
        const dot = document.createElement("button");

        dot.type = "button";
        dot.className = "slider-dot" +
            (index === currentSlide ? " active" : "");

        dot.setAttribute("aria-label", `Mostrar fotografía ${index + 1}`);

        dot.addEventListener("click", () => {
            currentSlide = index;
            renderGallery();
            restartSlideshow();
        });

        el.sliderDots.appendChild(dot);
    });

    el.prev.hidden = photos.length < 2;
    el.next.hidden = photos.length < 2;
    el.counter.hidden = false;

    el.counter.textContent = `${currentSlide + 1}/${MAX_PHOTOS}`;
    el.status.textContent = `${photos.length}/${MAX_PHOTOS} fotografías`;

    startSlideshow();
}

/* ==========================================
   7. CARRUSEL INFINITO
========================================== */

function nextPhoto() {
    if (photos.length <= 1) return;

    currentSlide = (currentSlide + 1) % photos.length;
    renderGallery();
}

function previousPhoto() {
    if (photos.length <= 1) return;

    currentSlide =
        (currentSlide - 1 + photos.length) % photos.length;

    renderGallery();
}

function stopSlideshow() {
    if (slideTimer !== null) {
        clearInterval(slideTimer);
        slideTimer = null;
    }
}

function startSlideshow() {
    stopSlideshow();

    // No iniciar si hay una sola imagen o la pestaña está oculta
    if (photos.length <= 1 || document.hidden) return;

    slideTimer = setInterval(() => {
        nextPhoto();
    }, SLIDE_INTERVAL);
}

function restartSlideshow() {
    startSlideshow();
}

/* Pausar al cambiar de pestaña */
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        stopSlideshow();
    } else {
        startSlideshow();
    }
});

/* Pausar cuando el usuario interactúa con la galería */
const galleryCard = document.querySelector(".gallery-card");

if (galleryCard) {
    galleryCard.addEventListener("mouseenter", stopSlideshow);
    galleryCard.addEventListener("mouseleave", startSlideshow);
    galleryCard.addEventListener("focusin", stopSlideshow);
    galleryCard.addEventListener("focusout", startSlideshow);
}

/* ==========================================
   8. CARGAR Y SUBIR FOTOGRAFÍAS
========================================== */

async function loadGallery() {
    try {
        photos = await getPhotos();
        renderGallery();
    } catch (error) {
        console.error("Error cargando la galería:", error);
        el.status.textContent = "Error al cargar fotografías.";
    }
}

async function uploadPhotos(event) {
    const files = Array.from(event.target.files || []);

    // Permitir seleccionar nuevamente los mismos archivos
    event.target.value = "";

    if (!files.length) return;

    const acceptedTypes = [
        "image/jpeg",
        "image/png",
        "image/webp"
    ];

    const validFiles = files.filter((file =>
        acceptedTypes.includes(file.type)
    ));

    if (validFiles.length !== files.length) {
        el.status.textContent =
            "Se omitieron archivos que no son imágenes válidas.";
    }

    const availableSlots = MAX_PHOTOS - photos.length;

    if (availableSlots <= 0) {
        el.status.textContent =
            "La galería ya tiene 10 fotografías.";
        return;
    }

    const selectedFiles = validFiles.slice(0, availableSlots);

    if (validFiles.length > availableSlots) {
        el.status.textContent =
            `Solo se agregarán ${availableSlots} fotografía(s).`;
    }

    try {
        for (const file of selectedFiles) {
            await savePhoto(file);
        }

        photos = await getPhotos();

        // Mostrar las imágenes recién agregadas
        currentSlide = Math.max(0, photos.length - selectedFiles.length);

        renderGallery();
        restartSlideshow();

    } catch (error) {
        console.error("Error guardando fotografías:", error);
        el.status.textContent = "No se pudieron guardar las imágenes.";
    }
}

function initGallery() {
    el.imageUpload.addEventListener("change", uploadPhotos);

    el.next.addEventListener("click", () => {
        nextPhoto();
        restartSlideshow();
    });

    el.prev.addEventListener("click", () => {
        previousPhoto();
        restartSlideshow();
    });
}

/* ==========================================
   9. INFORMACIÓN METEOROLÓGICA
========================================== */

const weatherMap = {
    0: ["Despejado", "☀️"],
    1: ["Mayormente despejado", "🌤️"],
    2: ["Parcialmente nublado", "⛅"],
    3: ["Nublado", "☁️"],
    45: ["Niebla", "🌫️"],
    48: ["Niebla con escarcha", "🌫️"],
    51: ["Llovizna ligera", "🌦️"],
    53: ["Llovizna moderada", "🌦️"],
    55: ["Llovizna intensa", "🌧️"],
    56: ["Llovizna helada ligera", "🌧️"],
    57: ["Llovizna helada intensa", "🌧️"],
    61: ["Lluvia ligera", "🌦️"],
    63: ["Lluvia moderada", "🌧️"],
    65: ["Lluvia fuerte", "🌧️"],
    66: ["Lluvia helada ligera", "🌧️"],
    67: ["Lluvia helada fuerte", "🌧️"],
    71: ["Nieve ligera", "🌨️"],
    73: ["Nieve moderada", "🌨️"],
    75: ["Nieve fuerte", "❄️"],
    77: ["Granizo pequeño", "🌨️"],
    80: ["Chubascos ligeros", "🌦️"],
    81: ["Chubascos moderados", "🌧️"],
    82: ["Chubascos fuertes", "⛈️"],
    85: ["Nieve ligera", "🌨️"],
    86: ["Nieve fuerte", "❄️"],
    95: ["Tormenta eléctrica", "⛈️"],
    96: ["Tormenta con granizo", "⛈️"],
    99: ["Tormenta con granizo fuerte", "⛈️"]
};

function getWeatherInfo(code) {
    return weatherMap[code] || ["Clima variable", "🌡️"];
}

/* ==========================================
   10. UBICACIÓN Y CIUDAD
========================================== */

function getDeviceTimezone() {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
}

/*
   La zona horaria permite una aproximación regional,
   pero no identifica con certeza la ciudad.
*/
function timezoneFallback() {
    const timezone = getDeviceTimezone();

    const approximateLocations = {
        "America/Bogota": {
            latitude: 4.7110,
            longitude: -74.0721,
            label: "Colombia (ubicación aproximada)"
        },
        "America/Lima": {
            latitude: -12.0464,
            longitude: -77.0428,
            label: "Perú (ubicación aproximada)"
        },
        "America/Mexico_City": {
            latitude: 19.4326,
            longitude: -99.1332,
            label: "México (ubicación aproximada)"
        },
        "America/Santiago": {
            latitude: -33.4489,
            longitude: -70.6693,
            label: "Chile (ubicación aproximada)"
        },
        "America/Argentina/Buenos_Aires": {
            latitude: -34.6037,
            longitude: -58.3816,
            label: "Argentina (ubicación aproximada)"
        },
        "America/Caracas": {
            latitude: 10.4806,
            longitude: -66.9036,
            label: "Venezuela (ubicación aproximada)"
        },
        "America/Guayaquil": {
            latitude: -0.1807,
            longitude: -78.4678,
            label: "Ecuador (ubicación aproximada)"
        },
        "America/Panama": {
            latitude: 8.9824,
            longitude: -79.5199,
            label: "Panamá (ubicación aproximada)"
        },
        "Europe/Madrid": {
            latitude: 40.4168,
            longitude: -3.7038,
            label: "España (ubicación aproximada)"
        }
    };

    return approximateLocations[timezone] || FALLBACK;
}

/* Convertir latitud/longitud en ciudad y país */
async function reverseGeocode(latitude, longitude) {
    const url = new URL(
        "https://api.bigdatacloud.net/data/reverse-geocode-client"
    );

    url.search = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        localityLanguage: "es"
    }).toString();

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("No fue posible identificar la ciudad.");
    }

    const result = await response.json();

    const city =
        result.city ||
        result.locality ||
        result.localityInfo?.administrative?.[0]?.name ||
        result.principalSubdivision ||
        "";

    const country = result.countryName || "";

    if (city && country) return `${city}, ${country}`;
    if (country) return country;

    throw new Error("No se recibió el nombre del lugar.");
}

/* ==========================================
   11. CONSULTAR EL CLIMA
========================================== */

async function getWeather(latitude, longitude) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");

    url.search = new URLSearchParams({
        latitude: String(latitude),
        longitude: String(longitude),
        current: [
            "temperature_2m",
            "relative_humidity_2m",
            "apparent_temperature",
            "weather_code",
            "wind_speed_10m"
        ].join(","),
        daily: [
            "weather_code",
            "temperature_2m_max",
            "temperature_2m_min"
        ].join(","),
        timezone: "auto",
        forecast_days: "5"
    }).toString();

    const response = await fetch(url);

    if (!response.ok) {
        throw new Error("No se pudo consultar el clima.");
    }

    const data = await response.json();

    if (!data.current || !data.daily) {
        throw new Error("La información del clima está incompleta.");
    }

    return data;
}

/* ==========================================
   12. MOSTRAR CLIMA Y PRONÓSTICO
========================================== */

function renderWeather(data, placeName) {
    const current = data.current;
    const currentInfo = getWeatherInfo(current.weather_code);

    el.weatherLocation.textContent = placeName;

    el.weatherCurrent.innerHTML = `
        <div class="weather-symbol">${currentInfo[1]}</div>
        <div class="weather-main">
            <div class="weather-temperature">
                ${Math.round(current.temperature_2m)}°
            </div>
            <div class="weather-description">${currentInfo[0]}</div>
            <div class="weather-details">
                <span>Sensación ${Math.round(current.apparent_temperature)}°</span>
                <span>Humedad ${current.relative_humidity_2m}%</span>
                <span>Viento ${Math.round(current.wind_speed_10m)} km/h</span>
            </div>
        </div>
    `;

    /* ERROR 2 CORREGIDO: generación del pronóstico */
    el.forecastList.innerHTML = data.daily.time.map((date, index) => {
        const info = getWeatherInfo(data.daily.weather_code[index]);

        const dayName = index === 0
            ? "Hoy"
            : new Intl.DateTimeFormat("es", {
                weekday: "short",
                timeZone: "UTC"
            }).format(new Date(`${date}T12:00:00Z`));

        const max = Math.round(data.daily.temperature_2m_max[index]);
        const min = Math.round(data.daily.temperature_2m_min[index]);

        return `
            <div class="forecast-day" title="${info[0]}">
                <div class="forecast-name">${dayName}</div>
                <div class="forecast-icon">${info[1]}</div>
                <div class="forecast-temps">
                    ${max}°
                    <span class="forecast-low">${min}°</span>
                </div>
            </div>
        `;
    }).join("");

    el.weatherNote.textContent =
        "Temperaturas en °C · Fuente: Open-Meteo";
}

/* ==========================================
   13. ERRORES DE CLIMA
========================================== */

function showWeatherError(message) {
    el.weatherCurrent.innerHTML = `
        <div class="weather-error">${message}</div>
    `;

    el.forecastList.innerHTML = `
        <div class="weather-error">Pronóstico no disponible.</div>
    `;
}

/* ==========================================
   14. OBTENER UBICACIÓN Y CONSULTAR
========================================== */

async function useCoordinates(latitude, longitude, fallbackLabel = "") {
    let placeName = fallbackLabel;

    try {
        placeName = await reverseGeocode(latitude, longitude);
    } catch (error) {
        console.warn("Geocodificación no disponible:", error);
    }

    el.city.textContent = placeName || "Ubicación detectada";
    el.weatherLocation.textContent = placeName || "Ubicación detectada";

    const data = await getWeather(latitude, longitude);
    renderWeather(data, placeName || "Ubicación detectada");
}

async function useFallbackLocation() {
    const fallback = timezoneFallback();

    el.city.textContent = fallback.label;
    el.weatherLocation.textContent = fallback.label;

    try {
        await useCoordinates(
            fallback.latitude,
            fallback.longitude,
            fallback.label
        );
    } catch (error) {
        console.error("Error en ubicación alternativa:", error);
        showWeatherError("No se pudo obtener el pronóstico.");
    }
}

/*
   getCurrentPosition se encapsula en una promesa
   para que el botón actualizar espere correctamente.
*/
function getDevicePosition() {
    return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
            reject(new Error("Ubicación no compatible."));
            return;
        }

        navigator.geolocation.getCurrentPosition(
            (position) => resolve(position),
            (error) => reject(error),
            {
                enableHighAccuracy: false,
                timeout: 12000,
                maximumAge: 10 * 60 * 1000
            }
        );
    });
}

async function detectLocation() {
    el.city.textContent = "Detectando ubicación...";
    el.weatherLocation.textContent = "Detectando ubicación...";

    try {
        const position = await getDevicePosition();

        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;

        userCoordinates = { latitude, longitude };

        await useCoordinates(latitude, longitude);

    } catch (error) {
        console.info("Ubicación no disponible, usando alternativa.");
        userCoordinates = null;
        await useFallbackLocation();
    }
}

/* ==========================================
   15. BOTÓN DE ACTUALIZAR CLIMA
========================================== */

async function refreshWeather() {
    if (weatherBusy) return;

    weatherBusy = true;
    el.refresh.disabled = true;

    el.weatherCurrent.innerHTML =
        '<div class="weather-loading">Actualizando clima...</div>';

    try {
        // Volver a solicitar la ubicación actual del dispositivo
        await detectLocation();
    } finally {
        weatherBusy = false;
        el.refresh.disabled = false;
    }
}

/* ==========================================
   16. INICIALIZAR APLICACIÓN
========================================== */

async function initApp() {
    startClock();
    initTheme();
    initSearch();
    initGallery();

    el.refresh.addEventListener("click", refreshWeather);

    // Iniciar detección de ubicación y clima
    detectLocation();

    // Inicializar base de datos y fotografías
    try {
        await openDB();
        await loadGallery();
    } catch (error) {
        console.error("Error inicializando la galería:", error);
        el.status.textContent =
            "No se pudo activar el almacenamiento de fotografías.";
    }
}

document.addEventListener("DOMContentLoaded", initApp);

/* Liberar recursos al salir */
window.addEventListener("beforeunload", revokeUrls);
