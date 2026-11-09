import { useRouter } from 'expo-router';
import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { classifyOrbitRegime, getOrbitalPeriodMinutes } from '../../src/orbital/engine';
import { evaluateEphemerisAge } from '../../src/providers/CacheManager';
import { globalOrchestrator } from '../../src/providers/ProviderOrchestrator';
import { useSatelliteStore } from '../../src/store/useSatelliteStore';
import type { ConstellationGroup, OrbitalRecord } from '../../src/types/satellite';

const GROUPS: { id: ConstellationGroup; label: string }[] = [
  { id: 'stations', label: 'Estaciones (ISS)' },
  { id: 'starlink', label: 'Starlink (SupGP)' },
  { id: 'gps-ops', label: 'GPS (MEO)' },
  { id: 'weather', label: 'Meteorológicos' },
  { id: 'geo', label: 'Geoestacionarios' },
  { id: 'active', label: 'Todos' },
];

export default function CatalogScreen() {
  const router = useRouter();
  const {
    catalog,
    activeGroup,
    selectedSatellite,
    ttlHours,
    isLoadingCatalog,
    lastProviderUsed,
    setActiveGroup,
    selectSatellite,
  } = useSatelliteStore();

  const [query, setQuery] = useState('');
  const [directLookupLoading, setDirectLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);

  const filteredCatalog = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        String(r.noradId).includes(q) ||
        (r.objectId && r.objectId.toLowerCase().includes(q))
    );
  }, [catalog, query]);

  const handleDirectNoradFetch = async () => {
    const num = parseInt(query.trim(), 10);
    if (Number.isNaN(num) || num <= 0) {
      setLookupError('Ingresa un NORAD ID numérico válido (ej: 25544, 20580, 43622)');
      return;
    }

    setDirectLookupLoading(true);
    setLookupError(null);
    try {
      const res = await globalOrchestrator.getOrbitalData(num, {
        ttlHours,
        forceRefresh: true,
      });
      selectSatellite(res.data);
      setDirectLookupLoading(false);
      router.push('/(tabs)');
    } catch (err) {
      setDirectLookupLoading(false);
      setLookupError(err instanceof Error ? err.message : 'No se pudo encontrar el NORAD ID');
    }
  };

  const renderItem = ({ item }: { item: OrbitalRecord }) => {
    const isSelected = item.noradId === selectedSatellite.noradId;
    const regime = classifyOrbitRegime(item.meanMotion, item.eccentricity);
    const period = getOrbitalPeriodMinutes(item.meanMotion);
    const age = evaluateEphemerisAge(item, ttlHours);

    return (
      <TouchableOpacity
        style={[styles.itemCard, isSelected && styles.itemCardSelected]}
        onPress={() => {
          selectSatellite(item);
          router.push('/(tabs)');
        }}
      >
        <View style={styles.itemHeader}>
          <Text style={styles.itemName}>{item.name}</Text>
          <View style={styles.badgesWrap}>
            <View style={styles.regimePill}>
              <Text style={styles.regimeText}>{regime}</Text>
            </View>
            <View style={styles.noradPill}>
              <Text style={styles.noradText}>#{item.noradId}</Text>
            </View>
          </View>
        </View>

        <Text style={styles.itemMeta}>
          Inclinación: {item.inclination.toFixed(2)}° · Período: {period.toFixed(1)} min · Formato:{' '}
          {item.format.toUpperCase()}
        </Text>
        <Text style={styles.itemEpoch}>
          {age.label} · Fuente: {item.source.toUpperCase()}
        </Text>
      </TouchableOpacity>
    );
  };

  return (
    <View style={styles.screen}>
      {/* Search Bar by Name or NORAD ID (RF-01) */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Buscar por nombre (ej. ISS, STARLINK, NOAA) o NORAD ID..."
          placeholderTextColor="#64748b"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            setLookupError(null);
          }}
        />
        {/^\d+$/.test(query.trim()) && (
          <TouchableOpacity
            style={styles.directBtn}
            onPress={handleDirectNoradFetch}
            disabled={directLookupLoading}
          >
            <Text style={styles.directBtnText}>
              {directLookupLoading ? '...' : 'Consultar API'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {lookupError && <Text style={styles.errorText}>{lookupError}</Text>}

      {/* Constellation Filter Chips (RF-08) */}
      <View style={styles.filterBar}>
        {GROUPS.map((g) => {
          const active = activeGroup === g.id;
          return (
            <TouchableOpacity
              key={g.id}
              style={[styles.filterChip, active && styles.filterChipActive]}
              onPress={() => setActiveGroup(g.id, false)}
            >
              <Text style={[styles.filterText, active && styles.filterTextActive]}>
                {g.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Provider status & manual catalog refresh */}
      <View style={styles.statusRow}>
        <Text style={styles.statusInfo}>
          {filteredCatalog.length} objetos · Fuente activa: {lastProviderUsed.toUpperCase()}
        </Text>
        <TouchableOpacity
          onPress={() => setActiveGroup(activeGroup, true)}
          style={styles.refreshCatalogBtn}
        >
          <Text style={styles.refreshCatalogText}>↻ Refrescar Catálogo</Text>
        </TouchableOpacity>
      </View>

      {isLoadingCatalog ? (
        <View style={styles.loaderBox}>
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text style={styles.loaderText}>
            Descargando efemérides OMM/TLE desde {activeGroup.toUpperCase()}...
          </Text>
        </View>
      ) : (
        <FlatList
          data={filteredCatalog}
          keyExtractor={(item) => String(item.noradId)}
          renderItem={renderItem}
          contentContainerStyle={styles.listContent}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#020617',
    padding: 12,
  },
  searchRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: '#f8fafc',
    fontSize: 13,
  },
  directBtn: {
    backgroundColor: '#0284c7',
    borderRadius: 10,
    paddingHorizontal: 12,
    justifyContent: 'center',
  },
  directBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    marginBottom: 6,
  },
  filterBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 10,
  },
  filterChip: {
    backgroundColor: '#0f172a',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  filterChipActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    borderColor: '#38bdf8',
  },
  filterText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  filterTextActive: {
    color: '#38bdf8',
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusInfo: {
    color: '#94a3b8',
    fontSize: 12,
  },
  refreshCatalogBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  refreshCatalogText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '700',
  },
  loaderBox: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loaderText: {
    color: '#94a3b8',
    marginTop: 10,
    fontSize: 13,
  },
  listContent: {
    paddingBottom: 24,
  },
  itemCard: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  itemCardSelected: {
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56, 189, 248, 0.08)',
  },
  itemHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  itemName: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  badgesWrap: {
    flexDirection: 'row',
    gap: 6,
  },
  regimePill: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  regimeText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '700',
  },
  noradPill: {
    backgroundColor: '#334155',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 4,
  },
  noradText: {
    color: '#e2e8f0',
    fontSize: 10,
    fontWeight: '700',
  },
  itemMeta: {
    color: '#cbd5e1',
    fontSize: 12,
  },
  itemEpoch: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 3,
  },
});

