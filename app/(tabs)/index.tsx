import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { EphemerisAgeBadge } from '../../src/components/common/EphemerisAgeBadge';
import { WorldMapView } from '../../src/components/map/WorldMapView';
import { useObserver } from '../../src/hooks/useObserver';
import {
  computeTelemetrySnapshot,
  propagateConstellationBatch,
} from '../../src/orbital/engine';
import { computeFootprint } from '../../src/orbital/footprint';
import { computeGroundTrack } from '../../src/orbital/groundTrack';
import { OBSERVER_PRESETS, useSatelliteStore } from '../../src/store/useSatelliteStore';
import type { TelemetrySnapshot } from '../../src/types/satellite';

export default function MapScreen() {
  const {
    selectedSatellite,
    starlinkConstellation,
    showConstellationLayer,
    constellationLimit,
    showFootprint,
    showGroundTrack,
    minElevationDeg,
    ttlHours,
    setShowConstellationLayer,
    setConstellationLimit,
    setShowFootprint,
    setShowGroundTrack,
    setMinElevationDeg,
    refreshSelectedSatellite,
    selectSatellite,
    setActiveGroup,
  } = useSatelliteStore();

  const { observer, setObserver, requestGpsLocation, isLocating } = useObserver();
  const [tick, setTick] = useState<number>(Date.now());
  const [constellationTick, setConstellationTick] = useState<number>(Date.now());

  // Initial fetch of live station catalog on mount
  useEffect(() => {
    setActiveGroup('stations', false);
  }, [setActiveGroup]);

  // Real-time 1.5s local SGP4 propagation loop (RF-02, RF-10)
  useEffect(() => {
    const id = setInterval(() => {
      setTick(Date.now());
    }, 1500);
    return () => clearInterval(id);
  }, []);

  // Throttled 4s batch propagation loop for Starlink constellation layer (RF-13)
  useEffect(() => {
    if (!showConstellationLayer) return;
    const id = setInterval(() => {
      setConstellationTick(Date.now());
    }, 4000);
    return () => clearInterval(id);
  }, [showConstellationLayer]);

  const liveTelemetry: TelemetrySnapshot | null = useMemo(() => {
    return computeTelemetrySnapshot(selectedSatellite, observer, new Date(tick));
  }, [selectedSatellite, observer, tick]);

  // Recompute ground track once per minute or when satellite changes (RF-11)
  const groundTrackMinuteBucket = Math.floor(tick / 60_000);
  const groundTrack = useMemo(() => {
    if (!showGroundTrack) return null;
    return computeGroundTrack(selectedSatellite, new Date(groundTrackMinuteBucket * 60_000));
  }, [selectedSatellite, showGroundTrack, groundTrackMinuteBucket]);

  // Compute instantaneous footprint polygon (RF-12)
  const footprint = useMemo(() => {
    if (!showFootprint || !liveTelemetry) return null;
    return computeFootprint(
      liveTelemetry.latitude,
      liveTelemetry.longitude,
      liveTelemetry.altitudeKm,
      minElevationDeg
    );
  }, [showFootprint, liveTelemetry, minElevationDeg]);

  // Batch-propagate Starlink subset outside main 1s frame (RF-13)
  const constellationSnapshots = useMemo(() => {
    if (!showConstellationLayer) return [];
    return propagateConstellationBatch(
      starlinkConstellation,
      observer,
      new Date(constellationTick),
      constellationLimit
    );
  }, [
    showConstellationLayer,
    starlinkConstellation,
    observer,
    constellationTick,
    constellationLimit,
  ]);

  const handleSelectConstellationSat = (noradId: number) => {
    const found = starlinkConstellation.find((s) => s.noradId === noradId);
    if (found) {
      selectSatellite(found);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Ephemeris freshness badge (RF-16) */}
      <EphemerisAgeBadge
        record={selectedSatellite}
        ttlHours={ttlHours}
        onRefreshPress={() => refreshSelectedSatellite()}
      />

      {/* World Map with real-time marker, antimeridian ground track, footprint & constellation */}
      <View style={styles.mapBox}>
        <WorldMapView
          telemetry={liveTelemetry}
          observer={observer}
          groundTrack={groundTrack}
          footprint={footprint}
          constellationSnapshots={constellationSnapshots}
          showGroundTrack={showGroundTrack}
          showFootprint={showFootprint}
          showConstellation={showConstellationLayer}
          onSelectConstellationSat={handleSelectConstellationSat}
        />
      </View>

      {/* Real-time SGP4 Subsatellite & Topocentric Telemetry Card (RF-02, RF-03) */}
      {liveTelemetry && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <View>
              <Text style={styles.satName}>{liveTelemetry.name}</Text>
              <Text style={styles.satSub}>
                NORAD #{liveTelemetry.noradId} · Órbita {liveTelemetry.orbitRegime} · Período{' '}
                {liveTelemetry.periodMinutes.toFixed(1)} min
              </Text>
            </View>
            <View
              style={[
                styles.visBadge,
                liveTelemetry.elevationDeg >= minElevationDeg
                  ? styles.visVisible
                  : liveTelemetry.elevationDeg >= 0
                  ? styles.visHorizon
                  : styles.visBelow,
              ]}
            >
              <Text style={styles.visText}>
                {liveTelemetry.elevationDeg >= minElevationDeg
                  ? 'ENLACE VISIBLE'
                  : liveTelemetry.elevationDeg >= 0
                  ? 'SOBRE HORIZONTE'
                  : 'BAJO HORIZONTE'}
              </Text>
            </View>
          </View>

          <View style={styles.grid}>
            <View style={styles.cell}>
              <Text style={styles.cellLabel}>Latitud Subsatelital</Text>
              <Text style={styles.cellValue}>{liveTelemetry.latitude.toFixed(4)}°</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.cellLabel}>Longitud Subsatelital</Text>
              <Text style={styles.cellValue}>{liveTelemetry.longitude.toFixed(4)}°</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.cellLabel}>Altitud (WGS84)</Text>
              <Text style={styles.cellValue}>{liveTelemetry.altitudeKm.toFixed(1)} km</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.cellLabel}>Velocidad Orbital</Text>
              <Text style={styles.cellValue}>{liveTelemetry.velocityKms.toFixed(2)} km/s</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.cellLabel}>Azimut (Observador)</Text>
              <Text style={[styles.cellValue, styles.accentCyan]}>
                {liveTelemetry.azimuthDeg.toFixed(1)}°
              </Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.cellLabel}>Elevación (Observador)</Text>
              <Text
                style={[
                  styles.cellValue,
                  liveTelemetry.elevationDeg >= 0 ? styles.accentGreen : styles.accentMuted,
                ]}
              >
                {liveTelemetry.elevationDeg.toFixed(1)}°
              </Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.cellLabel}>Slant Range (Distancia)</Text>
              <Text style={styles.cellValue}>{liveTelemetry.rangeKm.toFixed(0)} km</Text>
            </View>
            <View style={styles.cell}>
              <Text style={styles.cellLabel}>Radio Footprint</Text>
              <Text style={styles.cellValue}>
                {footprint ? `${footprint.coverageRadiusKm.toFixed(0)} km` : '—'}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Map Layers & Telecommunication Link Controls (RF-11, RF-12, RF-13) */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>Capas Geográficas y Enlace Satelital</Text>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>
            Ground Track (1.5 órbitas · corte antimeridiano ±180°)
          </Text>
          <Switch
            value={showGroundTrack}
            onValueChange={setShowGroundTrack}
            trackColor={{ false: '#334155', true: '#0284c7' }}
          />
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>
            Footprint / Área de Cobertura (ε mín = {minElevationDeg}°)
          </Text>
          <Switch
            value={showFootprint}
            onValueChange={setShowFootprint}
            trackColor={{ false: '#334155', true: '#0284c7' }}
          />
        </View>

        <View style={styles.chipRow}>
          <Text style={styles.chipRowLabel}>Umbral Elevación Mínima (ITU-R):</Text>
          {[0, 10, 20, 30].map((deg) => (
            <TouchableOpacity
              key={deg}
              onPress={() => setMinElevationDeg(deg)}
              style={[styles.chip, minElevationDeg === deg && styles.chipActive]}
            >
              <Text style={[styles.chipText, minElevationDeg === deg && styles.chipTextActive]}>
                {deg}°
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.toggleRow}>
          <Text style={styles.toggleLabel}>
            Capa Constelación Starlink SupGP ({constellationSnapshots.length} activos)
          </Text>
          <Switch
            value={showConstellationLayer}
            onValueChange={setShowConstellationLayer}
            trackColor={{ false: '#334155', true: '#9333ea' }}
          />
        </View>

        {showConstellationLayer && (
          <View style={styles.chipRow}>
            <Text style={styles.chipRowLabel}>Límite simultáneo (throttling):</Text>
            {[30, 60, 120].map((lim) => (
              <TouchableOpacity
                key={lim}
                onPress={() => setConstellationLimit(lim)}
                style={[styles.chip, constellationLimit === lim && styles.chipActivePurple]}
              >
                <Text
                  style={[styles.chipText, constellationLimit === lim && styles.chipTextActive]}
                >
                  {lim} sats
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {/* Observer GPS Location Selector */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.sectionTitle}>📍 Estación Terrena / Observador</Text>
            <Text style={styles.satSub}>
              {observer.name || 'GPS'} ({observer.latitude.toFixed(3)}°,{' '}
              {observer.longitude.toFixed(3)}° · {observer.altitude.toFixed(0)} msnm)
            </Text>
          </View>
          <TouchableOpacity
            onPress={requestGpsLocation}
            style={styles.gpsBtn}
            disabled={isLocating}
          >
            <Text style={styles.gpsBtnText}>{isLocating ? 'Ubicando...' : 'Usar mi GPS'}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.presetRow}>
          {OBSERVER_PRESETS.map((preset) => {
            const active =
              Math.abs(observer.latitude - preset.latitude) < 0.05 &&
              Math.abs(observer.longitude - preset.longitude) < 0.05;
            return (
              <TouchableOpacity
                key={preset.name}
                onPress={() => setObserver(preset)}
                style={[styles.presetBtn, active && styles.presetBtnActive]}
              >
                <Text style={[styles.presetText, active && styles.presetTextActive]}>
                  {preset.name}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#020617',
  },
  content: {
    padding: 12,
    paddingBottom: 32,
  },
  mapBox: {
    height: 310,
    marginVertical: 6,
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    marginVertical: 6,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  satName: {
    color: '#f8fafc',
    fontSize: 17,
    fontWeight: '800',
  },
  satSub: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  visBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  visVisible: {
    backgroundColor: '#059669',
  },
  visHorizon: {
    backgroundColor: '#d97706',
  },
  visBelow: {
    backgroundColor: '#334155',
  },
  visText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cell: {
    width: '48%',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 8,
  },
  cellLabel: {
    color: '#94a3b8',
    fontSize: 11,
  },
  cellValue: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    marginTop: 2,
  },
  accentCyan: {
    color: '#38bdf8',
  },
  accentGreen: {
    color: '#4ade80',
  },
  accentMuted: {
    color: '#94a3b8',
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 6,
  },
  toggleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#1e293b',
  },
  toggleLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
    marginBottom: 4,
  },
  chipRowLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginRight: 4,
  },
  chip: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  chipActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    borderColor: '#38bdf8',
  },
  chipActivePurple: {
    backgroundColor: 'rgba(168, 85, 247, 0.25)',
    borderColor: '#a855f7',
  },
  chipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#f8fafc',
  },
  gpsBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
  },
  gpsBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  presetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  presetBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  presetBtnActive: {
    borderColor: '#22c55e',
    backgroundColor: 'rgba(34, 197, 94, 0.16)',
  },
  presetText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  presetTextActive: {
    color: '#4ade80',
  },
});

