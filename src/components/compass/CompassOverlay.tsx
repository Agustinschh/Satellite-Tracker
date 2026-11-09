import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

interface Props {
  targetAzimuthDeg: number;
  targetElevationDeg: number;
  deviceHeadingDeg: number;
  devicePitchDeg: number;
  hasHardwareSensor: boolean;
  onSimulateHeadingChange: (deg: number) => void;
  onSimulatePitchChange: (deg: number) => void;
}

/**
 * Assisted Compass Overlay (RF-07):
 * Guides the user to align their phone's azimuth heading and elevation pitch
 * toward the target satellite (either live position or next pass AOS/TCA).
 */
export const CompassOverlay: React.FC<Props> = ({
  targetAzimuthDeg,
  targetElevationDeg,
  deviceHeadingDeg,
  devicePitchDeg,
  hasHardwareSensor,
  onSimulateHeadingChange,
  onSimulatePitchChange,
}) => {
  // Signed shortest angular difference (-180..180)
  let deltaAz = targetAzimuthDeg - deviceHeadingDeg;
  if (deltaAz > 180) deltaAz -= 360;
  if (deltaAz < -180) deltaAz += 360;

  const deltaEl = targetElevationDeg - devicePitchDeg;
  const isAligned = Math.abs(deltaAz) <= 8 && Math.abs(deltaEl) <= 8;

  const azInstruction =
    Math.abs(deltaAz) <= 8
      ? 'Azimut alineado'
      : deltaAz > 0
      ? `Gira ${Math.abs(deltaAz).toFixed(0)}° a la DERECHA ↻`
      : `Gira ${Math.abs(deltaAz).toFixed(0)}° a la IZQUIERDA ↺`;

  const elInstruction =
    Math.abs(deltaEl) <= 8
      ? 'Elevación alineada'
      : deltaEl > 0
      ? `Inclina ${Math.abs(deltaEl).toFixed(0)}° hacia ARRIBA ↑`
      : `Inclina ${Math.abs(deltaEl).toFixed(0)}° hacia ABAJO ↓`;

  return (
    <View style={[styles.card, isAligned && styles.cardAligned]}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>🧭 Modo Brújula Asistida (RF-07)</Text>
        <View style={[styles.statusPill, isAligned ? styles.pillOk : styles.pillSeeking]}>
          <Text style={styles.statusText}>
            {isAligned ? 'OBJETIVO ALINEADO' : 'ORIENTANDO ANTENA/DISPOSITIVO'}
          </Text>
        </View>
      </View>

      <View style={styles.metricsRow}>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Rumbo Dispositivo</Text>
          <Text style={styles.metricVal}>{deviceHeadingDeg.toFixed(0)}°</Text>
          <Text style={styles.metricSub}>Objetivo: {targetAzimuthDeg.toFixed(0)}°</Text>
        </View>
        <View style={styles.metricBox}>
          <Text style={styles.metricLabel}>Inclinación (Pitch)</Text>
          <Text style={styles.metricVal}>{devicePitchDeg.toFixed(0)}°</Text>
          <Text style={styles.metricSub}>Objetivo: {targetElevationDeg.toFixed(1)}°</Text>
        </View>
      </View>

      <View style={styles.guidanceBox}>
        <Text style={[styles.guidanceText, isAligned && styles.guidanceAligned]}>
          {azInstruction}
        </Text>
        <Text style={[styles.guidanceText, isAligned && styles.guidanceAligned]}>
          {elInstruction}
        </Text>
      </View>

      {!hasHardwareSensor && (
        <View style={styles.simBox}>
          <Text style={styles.simLabel}>
            Simulador de Orientación (útil en emulador sin magnetómetro físico):
          </Text>
          <View style={styles.simButtonsRow}>
            <TouchableOpacity
              style={styles.simBtn}
              onPress={() => onSimulateHeadingChange((deviceHeadingDeg - 15 + 360) % 360)}
            >
              <Text style={styles.simBtnText}>↺ Az -15°</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.simBtn}
              onPress={() => onSimulateHeadingChange((deviceHeadingDeg + 15) % 360)}
            >
              <Text style={styles.simBtnText}>↻ Az +15°</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.simBtn}
              onPress={() => onSimulatePitchChange(Math.max(-20, devicePitchDeg - 10))}
            >
              <Text style={styles.simBtnText}>↓ El -10°</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.simBtn}
              onPress={() => onSimulatePitchChange(Math.min(90, devicePitchDeg + 10))}
            >
              <Text style={styles.simBtnText}>↑ El +10°</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.simBtn, styles.simBtnSnap]}
              onPress={() => {
                onSimulateHeadingChange(Math.round((targetAzimuthDeg + 360) % 360));
                onSimulatePitchChange(Math.round(targetElevationDeg));
              }}
            >
              <Text style={styles.simBtnText}>🎯 Alinear</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#334155',
    marginTop: 10,
  },
  cardAligned: {
    borderColor: '#10b981',
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  title: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '700',
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  pillOk: {
    backgroundColor: '#059669',
  },
  pillSeeking: {
    backgroundColor: '#0284c7',
  },
  statusText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  metricsRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 8,
  },
  metricBox: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 11,
  },
  metricVal: {
    color: '#38bdf8',
    fontSize: 20,
    fontWeight: '800',
  },
  metricSub: {
    color: '#64748b',
    fontSize: 11,
  },
  guidanceBox: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    padding: 8,
    alignItems: 'center',
  },
  guidanceText: {
    color: '#fde047',
    fontSize: 13,
    fontWeight: '700',
    marginVertical: 2,
  },
  guidanceAligned: {
    color: '#34d399',
  },
  simBox: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#334155',
    paddingTop: 8,
  },
  simLabel: {
    color: '#94a3b8',
    fontSize: 11,
    marginBottom: 6,
  },
  simButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  simBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 6,
  },
  simBtnSnap: {
    backgroundColor: '#0284c7',
  },
  simBtnText: {
    color: '#f8fafc',
    fontSize: 11,
    fontWeight: '600',
  },
});

