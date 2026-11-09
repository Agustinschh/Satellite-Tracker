import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { evaluateEphemerisAge } from '../../providers/CacheManager';
import type { OrbitalRecord } from '../../types/satellite';

interface Props {
  record: OrbitalRecord;
  ttlHours: number;
  onRefreshPress?: () => void;
}

export const EphemerisAgeBadge: React.FC<Props> = ({
  record,
  ttlHours,
  onRefreshPress,
}) => {
  const info = evaluateEphemerisAge(record, ttlHours);

  const badgeColors =
    info.freshness === 'fresh'
      ? { bg: 'rgba(16, 185, 129, 0.16)', border: '#10b981', text: '#34d399' }
      : info.freshness === 'aging'
      ? { bg: 'rgba(245, 158, 11, 0.16)', border: '#f59e0b', text: '#fbbf24' }
      : { bg: 'rgba(239, 68, 68, 0.18)', border: '#ef4444', text: '#f87171' };

  return (
    <View style={[styles.container, { backgroundColor: badgeColors.bg, borderColor: badgeColors.border }]}>
      <View style={styles.row}>
        <View style={[styles.dot, { backgroundColor: badgeColors.border }]} />
        <Text style={[styles.label, { color: badgeColors.text }]}>
          {info.label} · Fuente: {record.source.toUpperCase()}
        </Text>
        {onRefreshPress && (
          <TouchableOpacity onPress={onRefreshPress} style={styles.refreshBtn}>
            <Text style={styles.refreshText}>Actualizar</Text>
          </TouchableOpacity>
        )}
      </View>
      {info.freshness === 'stale' && (
        <Text style={styles.warningText}>
          ⚠️ Datos orbitales con antigüedad {'>'} TTL ({ttlHours}h) o modo semilla offline. Se recomienda refrescar efemérides para minimizar deriva SGP4.
        </Text>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginVertical: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 8,
  },
  label: {
    flex: 1,
    fontSize: 12,
    fontWeight: '600',
  },
  refreshBtn: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#38bdf8',
    marginLeft: 8,
  },
  refreshText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
  },
  warningText: {
    color: '#fca5a5',
    fontSize: 11,
    marginTop: 4,
  },
});

