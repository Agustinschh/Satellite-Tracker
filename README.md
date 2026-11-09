# 🛰️ TP7: Satellite Tracker — Propagación Orbital SGP4/SDP4 en Tiempo Real

Aplicación móvil desarrollada en **React Native (Expo + TypeScript)** para el cálculo en tiempo real de posiciones satelitales (LEO, MEO y GEO), visualización de ground track y footprint en mapa mundial, predicción de ventanas de visibilidad (AOS/TCA/LOS) con Sky Chart polar, modo brújula asistida y validación cruzada contra APIs públicas.

---

## 🚀 Características Principales (Requisitos Funcionales RF-01 a RF-16)

- **Motor Orbital SGP4/SDP4 Local (`satellite.js` v6.0.1):**
  - Soporte nativo para formato **OMM/JSON (`json2satrec`)** y **TLE clásico (`twoline2satrec`)** ([`src/orbital/engine.ts`](./src/orbital/engine.ts)).
  - Cálculo en tiempo real de punto subsatelital (latitud, longitud, altitud WGS84, velocidad orbital) y ángulos topocéntricos (azimut, elevación, slant range) respecto de la posición GPS del observador.
- **Visualización Geográfica sobre Mapa Mundial ([`src/components/map/WorldMapView.tsx`](./src/components/map/WorldMapView.tsx)):**
  - Marcador en tiempo real del satélite activo (actualización local cada $1.5\text{ s}$ sin consultar APIs por frame).
  - **Ground Track** pasado y futuro con resolución automática del cruce del **antimeridiano ($\pm 180^\circ$)** ([`src/orbital/groundTrack.ts`](./src/orbital/groundTrack.ts)).
  - **Footprint (Área de Cobertura)** calculado mediante polígonos geodésicos según la altitud del satélite y el ángulo de elevación mínima configurable ($\varepsilon_{\min} \in \{0^\circ, 10^\circ, 20^\circ, 30^\circ\}$) ([`src/orbital/footprint.ts`](./src/orbital/footprint.ts)).
  - **Capa de Constelación Starlink (`SupGP`):** Propagación en lote con *throttling* y límite configurable de objetos simultáneos (30, 60, 120 satélites) para preservar 60 FPS en la UI.
- **Predictor de Visibilidad, Sky Chart Polar y Modo Brújula ([`app/(tabs)/passes.tsx`](./app/(tabs)/passes.tsx)):**
  - Algoritmo de búsqueda por refinamiento **Grueso $\rightarrow$ Fino** (bisección + sección dorada) para determinar **AOS**, **TCA (elevación máxima)** y **LOS** ([`src/orbital/passPredictor.ts`](./src/orbital/passPredictor.ts)).
  - **Sky Chart Polar en SVG** ([`src/components/skychart/PolarSkyChart.tsx`](./src/components/skychart/PolarSkyChart.tsx)) y **Modo Brújula Asistida** ([`src/components/compass/CompassOverlay.tsx`](./src/components/compass/CompassOverlay.tsx)).
  - Programación de notificaciones locales $N$ minutos antes de cada pase + botón de disparo de demostración en 3 segundos ([`src/notifications/passNotifications.ts`](./src/notifications/passNotifications.ts)).
- **Capa de Proveedores con Rate Limiter, Caché TTL y Fallback ([`src/providers/`](./src/providers/)):**
  - Implementaciones para **CelesTrak** (GP + SupGP de Starlink), **Space-Track.org**, **N2YO** y **Where the ISS at?**.
  - Orquestador con fallback automático y operación 100% offline mediante caché persistente y catálogo semilla embebido.
- **Modo Validación Cruzada ([`app/(tabs)/validation.tsx`](./app/(tabs)/validation.tsx)):**
  - Contraste en vivo contra **Where the ISS at?** (NORAD 25544) y **N2YO** (cualquier satélite), reportando error superficial Haversine (km), error 3D ECEF (km) y exportación en tabla Markdown.

---

## 🛠️ Instalación y Ejecución

```bash
# 1. Instalar dependencias
npm install

# 2. Ejecutar suite de pruebas unitarias (Jest) y verificación de tipos (TypeScript)
npm run typecheck
npm test

# 3. Iniciar la aplicación con Expo (Android / iOS / Web)
npm start

# 4. (Opcional) Iniciar el micro-proxy Node.js para credenciales de N2YO y Space-Track
npm run proxy
```

---

## 📚 Documentación Técnica Entregable (`/docs`)

- [Modelo de Propagación Orbital SGP4/SDP4, Supuestos y Limitaciones](./docs/MODELO_PROPAGACION.md)
- [Decisiones sobre Fuentes de Datos, Caso Starlink SupGP, Límites de API y Caché/Fallback](./docs/DECISIONES_FUENTES_DATOS.md)
- [Informe de Validación Cruzada (SGP4 Local vs. Where the ISS at? y N2YO)](./docs/INFORME_VALIDACION.md)

