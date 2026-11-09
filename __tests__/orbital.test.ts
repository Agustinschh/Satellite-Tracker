import {
  classifyOrbitRegime,
  computeTelemetrySnapshot,
  getOrbitalPeriodMinutes,
  propagateSubsatellitePoint,
} from '../src/orbital/engine';
import { computeCoverageGeometry, computeFootprint } from '../src/orbital/footprint';
import { computeGroundTrack, splitAtAntimeridian } from '../src/orbital/groundTrack';
import { predictPasses } from '../src/orbital/passPredictor';
import { evaluateEphemerisAge } from '../src/providers/CacheManager';
import { buildRecordFromTle } from '../src/providers/N2yoProvider';
import { ProviderOrchestrator } from '../src/providers/ProviderOrchestrator';
import { RateLimiter } from '../src/providers/RateLimiter';
import { getSeedCatalog } from '../src/providers/seedCatalog';
import { runBackgroundOrbitalSync } from '../src/notifications/backgroundTask';
import {
  compareLocalWithExternal,
  computeHaversineDistanceKm,
} from '../src/validation/positionValidator';

const BUENOS_AIRES_OBSERVER = {
  name: 'Buenos Aires',
  latitude: -34.6037,
  longitude: -58.3816,
  altitude: 25,
};

describe('TP7 Satellite Tracker — Motor Orbital SGP4/SDP4 y Geometría', () => {
  const seed = getSeedCatalog('active');
  const issOmmRecord = seed.find((r) => r.noradId === 25544)!;
  const geoRecord = seed.find((r) => r.noradId === 41866)!; // GOES-16 GEO

  test('1. Propagación SGP4 desde formato OMM JSON (json2satrec) para ISS (NORAD 25544)', () => {
    const snap = computeTelemetrySnapshot(issOmmRecord, BUENOS_AIRES_OBSERVER, new Date());
    expect(snap).not.toBeNull();
    expect(snap!.noradId).toBe(25544);
    expect(snap!.latitude).toBeGreaterThanOrEqual(-52.5);
    expect(snap!.latitude).toBeLessThanOrEqual(52.5);
    expect(snap!.longitude).toBeGreaterThanOrEqual(-180);
    expect(snap!.longitude).toBeLessThanOrEqual(180);
    // ISS altitude is ~380..450 km and orbital velocity ~7.66 km/s
    expect(snap!.altitudeKm).toBeGreaterThan(350);
    expect(snap!.altitudeKm).toBeLessThan(480);
    expect(snap!.velocityKms).toBeGreaterThan(7.4);
    expect(snap!.velocityKms).toBeLessThan(7.9);
    expect(snap!.orbitRegime).toBe('LEO');
  });

  test('2. Propagación SGP4 desde formato TLE clásico (twoline2satrec)', () => {
    const line1 = '1 25544U 98067A   25085.50000000  .00016717  00000-0  10270-3 0  9993';
    const line2 = '2 25544  51.6416 142.3180 0004721  78.4120 281.7450 15.49814520489201';
    const tleRecord = buildRecordFromTle(25544, 'ISS (ZARYA)', line1, line2, 'wheretheiss');

    const pt = propagateSubsatellitePoint(tleRecord, new Date('2025-03-26T12:00:00Z'));
    expect(pt).not.toBeNull();
    expect(pt!.altitudeKm).toBeGreaterThan(380);
    expect(pt!.altitudeKm).toBeLessThan(450);
  });

  test('3. Clasificación de régimen orbital (LEO, MEO, GEO) y cálculo de período', () => {
    expect(classifyOrbitRegime(15.5, 0.0004)).toBe('LEO');
    expect(classifyOrbitRegime(2.005, 0.01)).toBe('MEO');
    expect(classifyOrbitRegime(1.0027, 0.0001)).toBe('GEO');
    expect(getOrbitalPeriodMinutes(15.0)).toBeCloseTo(96, 1);
  });

  test('4. Corte de Ground Track en el cruce del antimeridiano (±180°)', () => {
    const syntheticPoints = [
      { latitude: 10, longitude: 170 },
      { latitude: 15, longitude: 178 },
      { latitude: 20, longitude: -175 }, // Cruza +180 -> -180
      { latitude: 25, longitude: -165 },
    ];

    const segments = splitAtAntimeridian(syntheticPoints);
    expect(segments.length).toBe(2);
    // Primer segmento termina exactamente en +180°
    expect(segments[0][segments[0].length - 1].longitude).toBe(180);
    // Segundo segmento comienza exactamente en -180°
    expect(segments[1][0].longitude).toBe(-180);

    const fullTrack = computeGroundTrack(issOmmRecord, new Date());
    expect(fullTrack.pastSegments.length).toBeGreaterThanOrEqual(1);
    expect(fullTrack.futureSegments.length).toBeGreaterThanOrEqual(1);
  });

  test('5. Geometría del Footprint (ISS a 420 km y GEO a 35786 km)', () => {
    // ISS a 420 km con elevación mínima 0° -> ángulo central ~20.3° y radio ~2260 km
    const issCov = computeCoverageGeometry(420, 0);
    expect(issCov.centralAngleDeg).toBeCloseTo(20.26, 1);
    expect(issCov.coverageRadiusKm).toBeGreaterThan(2200);
    expect(issCov.coverageRadiusKm).toBeLessThan(2310);

    // Satélite GEO a 35786 km con elevación mínima 0° -> ángulo central ~81.3°
    const geoCov = computeCoverageGeometry(35786, 0);
    expect(geoCov.centralAngleDeg).toBeCloseTo(81.3, 1);

    const fp = computeFootprint(-34.6, -58.4, 420, 10, 36);
    expect(fp.polygons.length).toBeGreaterThanOrEqual(1);
    expect(fp.coverageRadiusKm).toBeCloseTo(1389.6, 0);
  });

  test('6. Predictor de Ventanas de Visibilidad AOS / TCA / LOS (Grueso -> Fino)', () => {
    const passes = predictPasses(issOmmRecord, BUENOS_AIRES_OBSERVER, {
      hoursAhead: 48,
      minElevationDeg: 10,
      maxPasses: 5,
    });

    expect(passes.length).toBeGreaterThan(0);
    const firstPass = passes[0];
    expect(firstPass.aosTime).toBeLessThan(firstPass.tcaTime);
    expect(firstPass.tcaTime).toBeLessThan(firstPass.losTime);
    expect(firstPass.maxElevationDeg).toBeGreaterThanOrEqual(10);
    expect(firstPass.samples.length).toBeGreaterThan(5);

    // Caso borde: Satélite GEO continuamente visible sobre América
    const geoPasses = predictPasses(geoRecord, BUENOS_AIRES_OBSERVER, {
      hoursAhead: 24,
      minElevationDeg: 10,
    });
    expect(geoPasses.length).toBe(1);
    expect(geoPasses[0].isGeostationaryVisible).toBe(true);
  });

  test('7. Validación cruzada de posición y cálculo de error en km (Haversine y 3D ECEF)', () => {
    const now = new Date();
    const localSnap = computeTelemetrySnapshot(issOmmRecord, BUENOS_AIRES_OBSERVER, now)!;

    // Simulamos una muestra externa desplazada ~0.01 grados (~1.1 km) y 0.5 km en altitud
    const comparison = compareLocalWithExternal(issOmmRecord, BUENOS_AIRES_OBSERVER, {
      provider: 'wheretheiss',
      noradId: 25544,
      timestamp: now.getTime(),
      latitude: localSnap.latitude + 0.01,
      longitude: localSnap.longitude + 0.01,
      altitudeKm: localSnap.altitudeKm + 0.5,
    });

    expect(comparison.errors.surfaceDistanceKm).toBeGreaterThan(0.8);
    expect(comparison.errors.surfaceDistanceKm).toBeLessThan(2.5);
    expect(comparison.errors.euclidean3dKm).toBeGreaterThan(0.9);
    expect(comparison.errors.euclidean3dKm).toBeLessThan(3.0);

    const zeroDist = computeHaversineDistanceKm(-34.6, -58.4, -34.6, -58.4);
    expect(zeroDist).toBeCloseTo(0, 5);
  });

  test('8. Evaluación de antigüedad de efemérides y TTL (RF-09, RF-16)', () => {
    const freshAge = evaluateEphemerisAge(
      { ...issOmmRecord, source: 'celestrak', epoch: new Date(Date.now() - 2 * 3600_000).toISOString() },
      12
    );
    expect(freshAge.freshness).toBe('fresh');

    const staleAge = evaluateEphemerisAge(
      { ...issOmmRecord, source: 'celestrak', epoch: new Date(Date.now() - 60 * 3600_000).toISOString() },
      12
    );
    expect(staleAge.freshness).toBe('stale');
  });

  test('9. RateLimiter y ProviderOrchestrator con fallback automático ante fallas (RF-14)', async () => {
    const limiter = new RateLimiter();
    await limiter.acquire('celestrak');
    const stats = limiter.getUsageStats('celestrak');
    expect(stats.usedInWindow).toBe(1);

    // Simulamos fallo HTTP 503 en proveedores remotos y verificamos fallback a caché/semilla
    const originalFetch = global.fetch;
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({}),
    })) as unknown as typeof fetch;

    try {
      const orchestrator = new ProviderOrchestrator();
      const res = await orchestrator.getOrbitalData(25544, { forceRefresh: true });
      expect(res.data.noradId).toBe(25544);
      expect(res.fallbackChainAttempted.length).toBeGreaterThan(1);

      const syncSummary = await runBackgroundOrbitalSync(false);
      expect(syncSummary.recalculatedPassesCount).toBeGreaterThanOrEqual(0);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
