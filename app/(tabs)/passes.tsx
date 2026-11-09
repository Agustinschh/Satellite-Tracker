import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CompassOverlay } from '../../src/components/compass/CompassOverlay';
import { PolarSkyChart } from '../../src/components/skychart/PolarSkyChart';
import { useHeading } from '../../src/hooks/useHeading';
import {
  schedulePassReminder,
  triggerDemoPassNotification,
} from '../../src/notifications/passNotifications';
import { computeTelemetrySnapshot } from '../../src/orbital/engine';
import { predictPassesAsync } from '../../src/orbital/passPredictor';
import { useSatelliteStore } from '../../src/store/useSatelliteStore';
import type { PassWindow } from '../../src/types/satellite';

export default function PassesScreen() {
  const {
    selectedSatellite,
    observer,
    minElevationDeg,
    notifyMinutesBefore,
    scheduledPassIds,
    setNotifyMinutesBefore,
    registerScheduledNotification,
  } = useSatelliteStore();

  const [passes, setPasses] = useState<PassWindow[]>([]);
  const [selectedPassId, setSelectedPassId] = useState<string | null>(null);
  const [isComputing, setIsComputing] = useState<boolean>(true);
  const [compassMode, setCompassMode] = useState<boolean>(false);
  const [notifFeedback, setNotifFeedback] = useState<string | null>(null);
  const [tick, setTick] = useState<number>(Date.now());

  const {
    headingDeg,
    pitchDeg,
    hasHardwareSensor,
    setSimulatedHeadingDeg,
    setSimulatedPitchDeg,
  } = useHeading(compassMode);

  useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 2000);
    return () => clearInterval(id);
  }, []);

  // Recompute pass predictions whenever satellite, observer, or minElevationDeg changes (RF-04)
  useEffect(() => {
    let active = true;
    setIsComputing(true);
    predictPassesAsync(selectedSatellite, observer, {
      hoursAhead: 36,
      minElevationDeg,
      maxPasses: 8,
    }).then((res) => {
      if (!active) return;
      setPasses(res);
      setSelectedPassId(res[0]?.id ?? null);
      setIsComputing(false);
    });
    return () => {
      active = false;
    };
  }, [selectedSatellite, observer, minElevationDeg]);

  const activePass = useMemo(() => {
    return passes.find((p) => p.id === selectedPassId) ?? passes[0] ?? null;
  }, [passes, selectedPassId]);

  const liveSnapshot = useMemo(() => {
    return computeTelemetrySnapshot(selectedSatellite, observer, new Date(tick));
  }, [selectedSatellite, observer, tick]);

  const targetAz =
    liveSnapshot && liveSnapshot.elevationDeg >= 0
      ? liveSnapshot.azimuthDeg
      : activePass
      ? activePass.tcaAzimuthDeg
      : 0;

  const targetEl =
    liveSnapshot && liveSnapshot.elevationDeg >= 0
      ? liveSnapshot.elevationDeg
      : activePass
      ? activePass.maxElevationDeg
      : 30;

  const handleScheduleReminder = async (pass: PassWindow) => {
    const notifId = await schedulePassReminder(pass, notifyMinutesBefore);
    registerScheduledNotification(pass.id, notifId);
    setNotifFeedback(
      `✅ Recordatorio programado ${notifyMinutesBefore} min antes del AOS de ${pass.satName}`
    );
  };

  const handleDemoNotification = async () => {
    const fired = await triggerDemoPassNotification(
      selectedSatellite.name,
      selectedSatellite.noradId,
      activePass?.maxElevationDeg ?? 65
    );
    setNotifFeedback(
      fired
        ? `🔔 Notificación de demostración enviada (se mostrará en 3 segundos)`
        : `🔔 [Simulación] Alerta disparada: Pase próximo de ${selectedSatellite.name} (Elev. máx ${(
            activePass?.maxElevationDeg ?? 65
          ).toFixed(1)}°)`
    );
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Header summary */}
      <View style={styles.card}>
        <Text style={styles.satTitle}>
          🛰️ {selectedSatellite.name} (NORAD #{selectedSatellite.noradId})
        </Text>
        <Text style={styles.subText}>
          Observador: {observer.name || 'GPS'} ({observer.latitude.toFixed(2)}°,{' '}
          {observer.longitude.toFixed(2)}°) · Elevación mín: {minElevationDeg}°
        </Text>
      </View>

      {/* Polar Sky Chart SVG (RF-05) */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>Gráfico Polar (Sky Chart SVG)</Text>
          <View style={styles.compassSwitchRow}>
            <Text style={styles.switchLabel}>Modo Brújula</Text>
            <Switch
              value={compassMode}
              onValueChange={setCompassMode}
              trackColor={{ false: '#334155', true: '#0284c7' }}
            />
          </View>
        </View>

        <PolarSkyChart
          size={290}
          pass={activePass}
          liveLook={liveSnapshot}
          minElevationDeg={minElevationDeg}
          deviceHeadingDeg={headingDeg}
          rotateWithCompass={compassMode}
        />

        {activePass && (
          <View style={styles.passLegendBox}>
            <Text style={styles.passLegendText}>
              🟢 AOS: {new Date(activePass.aosTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (Az{' '}
              {activePass.aosAzimuthDeg.toFixed(0)}°) · 🟡 MAX:{' '}
              {activePass.maxElevationDeg.toFixed(1)}° (Az {activePass.tcaAzimuthDeg.toFixed(0)}°) · 🔴 LOS:{' '}
              {new Date(activePass.losTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (Az{' '}
              {activePass.losAzimuthDeg.toFixed(0)}°)
            </Text>
          </View>
        )}

        {/* Compass Overlay (RF-07) */}
        {compassMode && (
          <CompassOverlay
            targetAzimuthDeg={targetAz}
            targetElevationDeg={targetEl}
            deviceHeadingDeg={headingDeg}
            devicePitchDeg={pitchDeg}
            hasHardwareSensor={hasHardwareSensor}
            onSimulateHeadingChange={setSimulatedHeadingDeg}
            onSimulatePitchChange={setSimulatedPitchDeg}
          />
        )}
      </View>

      {/* Notification Configuration & Demo Trigger (RF-06) */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.sectionTitle}>🔔 Recordatorios de Pase (RF-06)</Text>
          <TouchableOpacity style={styles.demoBtn} onPress={handleDemoNotification}>
            <Text style={styles.demoBtnText}>Disparar Notificación Demo (3s)</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.chipRow}>
          <Text style={styles.chipLabel}>Notificar antes del AOS:</Text>
          {[5, 10, 15, 30].map((m) => (
            <TouchableOpacity
              key={m}
              onPress={() => setNotifyMinutesBefore(m)}
              style={[styles.chip, notifyMinutesBefore === m && styles.chipActive]}
            >
              <Text style={[styles.chipText, notifyMinutesBefore === m && styles.chipTextActive]}>
                {m} min
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        {notifFeedback && <Text style={styles.feedbackText}>{notifFeedback}</Text>}
      </View>

      {/* Upcoming Visibility Windows List (RF-04) */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          Próximas Ventanas de Visibilidad (36 h · Búsqueda Gruesa → Fina)
        </Text>

        {isComputing ? (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color="#38bdf8" />
            <Text style={styles.loaderText}>Calculando pases AOS/TCA/LOS con SGP4...</Text>
          </View>
        ) : passes.length === 0 ? (
          <Text style={styles.emptyText}>
            No se encontraron pases que superen {minElevationDeg}° de elevación en las próximas 36 horas para esta ubicación.
          </Text>
        ) : (
          passes.map((p) => {
            const isSelected = activePass?.id === p.id;
            const isScheduled = Boolean(scheduledPassIds[p.id]);
            const dateStr = new Date(p.aosTime).toLocaleDateString([], {
              day: '2-digit',
              month: '2-digit',
            });
            const aosStr = new Date(p.aosTime).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });
            const losStr = new Date(p.losTime).toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            });

            return (
              <TouchableOpacity
                key={p.id}
                style={[styles.passItem, isSelected && styles.passItemSelected]}
                onPress={() => setSelectedPassId(p.id)}
              >
                <View style={styles.rowBetween}>
                  <Text style={styles.passDate}>
                    {p.isGeostationaryVisible
                      ? '🌐 Satélite Geoestacionario (Visible continuo)'
                      : `📅 ${dateStr} · ${aosStr} → ${losStr}`}
                  </Text>
                  <Text style={styles.passMaxEl}>Máx {p.maxElevationDeg.toFixed(1)}°</Text>
                </View>

                <Text style={styles.passDetails}>
                  Duración: {(p.durationSec / 60).toFixed(1)} min · AOS Az: {p.aosAzimuthDeg.toFixed(0)}° · TCA Az:{' '}
                  {p.tcaAzimuthDeg.toFixed(0)}° · LOS Az: {p.losAzimuthDeg.toFixed(0)}°
                </Text>

                <View style={styles.passActions}>
                  <TouchableOpacity
                    style={[styles.remindBtn, isScheduled && styles.remindBtnActive]}
                    onPress={() => handleScheduleReminder(p)}
                  >
                    <Text style={styles.remindBtnText}>
                      {isScheduled
                        ? `✓ Alerta activa (-${notifyMinutesBefore} min)`
                        : `🔔 Recordar ${notifyMinutesBefore} min antes`}
                    </Text>
                  </TouchableOpacity>
                </View>
              </TouchableOpacity>
            );
          })
        )}
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
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  satTitle: {
    color: '#f8fafc',
    fontSize: 16,
    fontWeight: '800',
  },
  subText: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 2,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
  },
  compassSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  switchLabel: {
    color: '#38bdf8',
    fontSize: 12,
    fontWeight: '600',
  },
  passLegendBox: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 8,
    marginTop: 8,
  },
  passLegendText: {
    color: '#e2e8f0',
    fontSize: 11,
    textAlign: 'center',
  },
  demoBtn: {
    backgroundColor: '#0284c7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
  },
  demoBtnText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '700',
  },
  chipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 4,
  },
  chipLabel: {
    color: '#94a3b8',
    fontSize: 12,
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
  chipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#f8fafc',
  },
  feedbackText: {
    color: '#34d399',
    fontSize: 12,
    marginTop: 8,
    fontWeight: '600',
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  loaderText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  emptyText: {
    color: '#94a3b8',
    fontSize: 12,
    paddingVertical: 10,
  },
  passItem: {
    backgroundColor: '#1e293b',
    borderRadius: 10,
    padding: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#334155',
  },
  passItemSelected: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.12)',
  },
  passDate: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  passMaxEl: {
    color: '#fde047',
    fontSize: 13,
    fontWeight: '800',
  },
  passDetails: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 2,
  },
  passActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 8,
  },
  remindBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  remindBtnActive: {
    backgroundColor: '#059669',
  },
  remindBtnText: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '600',
  },
});

