import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { globalCacheManager } from '../../src/providers/CacheManager';
import {
  loadProviderCredentials,
  saveProviderCredentials,
} from '../../src/providers/credentialsStore';
import { globalRateLimiter } from '../../src/providers/RateLimiter';
import { useSatelliteStore } from '../../src/store/useSatelliteStore';
import {
  formatValidationResultsMarkdown,
  runLiveValidation,
} from '../../src/validation/positionValidator';

export default function ValidationScreen() {
  const {
    selectedSatellite,
    observer,
    ttlHours,
    lastProviderUsed,
    lastFallbackChain,
    validationHistory,
    setTtlHours,
    addValidationResult,
    clearValidationHistory,
    refreshSelectedSatellite,
  } = useSatelliteStore();

  const [isRunning, setIsRunning] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [showMarkdown, setShowMarkdown] = useState(false);

  // Credentials state
  const [n2yoKey, setN2yoKey] = useState('');
  const [stUser, setStUser] = useState('');
  const [stPass, setStPass] = useState('');
  const [proxyUrl, setProxyUrl] = useState('');
  const [credsSavedMsg, setCredsSavedMsg] = useState<string | null>(null);

  useEffect(() => {
    loadProviderCredentials().then((c) => {
      setN2yoKey(c.n2yoApiKey);
      setStUser(c.spaceTrackIdentity);
      setStPass(c.spaceTrackPassword);
      setProxyUrl(c.proxyUrl);
    });
  }, []);

  const handleValidateWhereTheIss = async () => {
    setIsRunning(true);
    setErrorMsg(null);
    try {
      // Ensure we validate ISS (25544) with fresh orbital elements if currently selected
      let record = selectedSatellite;
      if (record.noradId !== 25544) {
        throw new Error(
          'Selecciona primero la ISS (NORAD 25544) en el Catálogo para validar contra Where the ISS at?, o usa el botón de N2YO para cualquier satélite.'
        );
      }
      if (record.source === 'seed') {
        record = await refreshSelectedSatellite();
      }
      const res = await runLiveValidation('wheretheiss', record, observer);
      addValidationResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error durante la validación');
    } finally {
      setIsRunning(false);
    }
  };

  const handleValidateN2yo = async () => {
    setIsRunning(true);
    setErrorMsg(null);
    try {
      const res = await runLiveValidation('n2yo', selectedSatellite, observer);
      addValidationResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Error consultando N2YO');
    } finally {
      setIsRunning(false);
    }
  };

  const handleSaveCredentials = async () => {
    await saveProviderCredentials({
      n2yoApiKey: n2yoKey,
      spaceTrackIdentity: stUser,
      spaceTrackPassword: stPass,
      proxyUrl,
    });
    setCredsSavedMsg('✓ Credenciales guardadas de forma segura en Keychain/Keystore');
    setTimeout(() => setCredsSavedMsg(null), 4000);
  };

  const ctStats = globalRateLimiter.getUsageStats('celestrak');
  const stStats = globalRateLimiter.getUsageStats('spacetrack');
  const n2Stats = globalRateLimiter.getUsageStats('n2yo');
  const issStats = globalRateLimiter.getUsageStats('wheretheiss');

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Live Cross-Validation Card (RF-15) */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          📊 Modo Validación Cruzada de Exactitud SGP4 (RF-15)
        </Text>
        <Text style={styles.subText}>
          Compara en el mismo instante t la posición propagada localmente por satellite.js contra
          fuentes independientes y calcula el error geodésico superficial (Haversine) y 3D ECEF en km.
        </Text>

        <View style={styles.btnRow}>
          <TouchableOpacity
            style={[styles.valBtn, styles.valBtnIss]}
            onPress={handleValidateWhereTheIss}
            disabled={isRunning}
          >
            <Text style={styles.valBtnText}>
              🛰️ Validar ISS vs WhereTheISS.at
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.valBtn, styles.valBtnN2yo]}
            onPress={handleValidateN2yo}
            disabled={isRunning}
          >
            <Text style={styles.valBtnText}>
              📡 Validar #{selectedSatellite.noradId} vs N2YO
            </Text>
          </TouchableOpacity>
        </View>

        {isRunning && (
          <View style={styles.loaderRow}>
            <ActivityIndicator size="small" color="#38bdf8" />
            <Text style={styles.loaderText}>
              Consultando API externa y comparando con propagación SGP4 local...
            </Text>
          </View>
        )}

        {errorMsg && <Text style={styles.errorText}>⚠️ {errorMsg}</Text>}

        {validationHistory.length > 0 && (
          <View style={styles.resultsBox}>
            <View style={styles.rowBetween}>
              <Text style={styles.resultsHeader}>
                Mediciones Registradas ({validationHistory.length})
              </Text>
              <View style={styles.smallRow}>
                <TouchableOpacity
                  style={styles.smallBtn}
                  onPress={() => setShowMarkdown(!showMarkdown)}
                >
                  <Text style={styles.smallBtnText}>
                    {showMarkdown ? 'Ver Tarjetas' : 'Tabla Markdown'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.smallBtn} onPress={clearValidationHistory}>
                  <Text style={styles.smallBtnText}>Limpiar</Text>
                </TouchableOpacity>
              </View>
            </View>

            {showMarkdown ? (
              <Text selectable style={styles.markdownCode}>
                {formatValidationResultsMarkdown(validationHistory)}
              </Text>
            ) : (
              validationHistory.map((item) => (
                <View key={item.id} style={styles.valItem}>
                  <View style={styles.rowBetween}>
                    <Text style={styles.valTitle}>
                      {item.satName} (#{item.noradId}) vs {item.provider.toUpperCase()}
                    </Text>
                    <Text style={styles.valErrorBadge}>
                      Error 3D: {item.errors.euclidean3dKm.toFixed(2)} km
                    </Text>
                  </View>

                  <Text style={styles.valCoord}>
                    SGP4 Local: Lat {item.local.latitude.toFixed(4)}°, Lon{' '}
                    {item.local.longitude.toFixed(4)}°, Alt {item.local.altitudeKm.toFixed(2)} km
                  </Text>
                  <Text style={styles.valCoord}>
                    API Externa: Lat {item.external.latitude.toFixed(4)}°, Lon{' '}
                    {item.external.longitude.toFixed(4)}°, Alt{' '}
                    {item.external.altitudeKm.toFixed(2)} km
                  </Text>
                  <Text style={styles.valDelta}>
                    ΔSuperficie (Haversine): {item.errors.surfaceDistanceKm.toFixed(2)} km · ΔAlt:{' '}
                    {item.errors.deltaAltKm.toFixed(2)} km · Antigüedad Epoch:{' '}
                    {item.epochAgeHours.toFixed(1)} h
                  </Text>
                </View>
              ))
            )}
          </View>
        )}
      </View>

      {/* Data Provider Orchestrator, Rate Limiter & Cache TTL Status (RF-09, RF-14) */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          ⚙️ Capa de Proveedores, Rate Limiter y Caché TTL (RF-09, RF-14)
        </Text>
        <Text style={styles.subText}>
          Último proveedor usado: {lastProviderUsed.toUpperCase()} · Cadena de resolución:{' '}
          {lastFallbackChain.join(' → ')}
        </Text>

        <View style={styles.statsGrid}>
          <View style={styles.statCell}>
            <Text style={styles.statName}>CelesTrak (GP/SupGP)</Text>
            <Text style={styles.statVal}>
              {ctStats.usedInWindow} / {ctStats.maxInWindow} req/min
            </Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statName}>Where the ISS at?</Text>
            <Text style={styles.statVal}>
              {issStats.usedInWindow} / {issStats.maxInWindow} req/min (≤1/s)
            </Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statName}>Space-Track.org</Text>
            <Text style={styles.statVal}>
              {stStats.usedInWindow} / {stStats.maxInWindow} req/min
            </Text>
          </View>
          <View style={styles.statCell}>
            <Text style={styles.statName}>N2YO REST API</Text>
            <Text style={styles.statVal}>
              {n2Stats.usedInWindow} / {n2Stats.maxInWindow} req/h
            </Text>
          </View>
        </View>

        <View style={styles.ttlRow}>
          <Text style={styles.ttlLabel}>TTL de Caché de Efemérides (RF-09):</Text>
          {[12, 18, 24].map((h) => (
            <TouchableOpacity
              key={h}
              onPress={() => setTtlHours(h)}
              style={[styles.ttlChip, ttlHours === h && styles.ttlChipActive]}
            >
              <Text style={[styles.ttlChipText, ttlHours === h && styles.ttlChipTextActive]}>
                {h} h
              </Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.clearCacheBtn}
            onPress={() => globalCacheManager.clearAll()}
          >
            <Text style={styles.clearCacheText}>Vaciar Caché</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Secure Credentials & Optional Proxy Configuration */}
      <View style={styles.card}>
        <Text style={styles.sectionTitle}>
          🔐 Credenciales Seguras (Keychain/Keystore & Proxy Opcional)
        </Text>
        <Text style={styles.subText}>
          CelesTrak y Where the ISS at? operan sin clave. Para habilitar validación contra N2YO o
          fallback con Space-Track, almacena tus credenciales en SecureStore o configura la URL del
          servidor proxy Node.js (proxy/server.js).
        </Text>

        <Text style={styles.inputLabel}>N2YO API Key:</Text>
        <TextInput
          style={styles.input}
          placeholder="Ej: ABC123-DEF456-GHI789-JKL0"
          placeholderTextColor="#64748b"
          value={n2yoKey}
          onChangeText={setN2yoKey}
          secureTextEntry
        />

        <Text style={styles.inputLabel}>Space-Track Usuario (Identity):</Text>
        <TextInput
          style={styles.input}
          placeholder="usuario@ejemplo.com"
          placeholderTextColor="#64748b"
          value={stUser}
          onChangeText={setStUser}
          autoCapitalize="none"
        />

        <Text style={styles.inputLabel}>Space-Track Contraseña:</Text>
        <TextInput
          style={styles.input}
          placeholder="••••••••"
          placeholderTextColor="#64748b"
          value={stPass}
          onChangeText={setStPass}
          secureTextEntry
        />

        <Text style={styles.inputLabel}>URL Backend Proxy Opcional (Node.js):</Text>
        <TextInput
          style={styles.input}
          placeholder="http://localhost:4000 (opcional)"
          placeholderTextColor="#64748b"
          value={proxyUrl}
          onChangeText={setProxyUrl}
          autoCapitalize="none"
        />

        <TouchableOpacity style={styles.saveBtn} onPress={handleSaveCredentials}>
          <Text style={styles.saveBtnText}>Guardar en Almacenamiento Seguro</Text>
        </TouchableOpacity>

        {credsSavedMsg && <Text style={styles.savedText}>{credsSavedMsg}</Text>}
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
    paddingBottom: 36,
  },
  card: {
    backgroundColor: '#0f172a',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  sectionTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 4,
  },
  subText: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 17,
    marginBottom: 10,
  },
  btnRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  valBtn: {
    flex: 1,
    minWidth: 145,
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  valBtnIss: {
    backgroundColor: '#0284c7',
  },
  valBtnN2yo: {
    backgroundColor: '#7c3aed',
  },
  valBtnText: {
    color: '#ffffff',
    fontSize: 12,
    fontWeight: '700',
  },
  loaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
  },
  loaderText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  errorText: {
    color: '#f87171',
    fontSize: 12,
    marginTop: 10,
  },
  resultsBox: {
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#1e293b',
    paddingTop: 10,
  },
  rowBetween: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  resultsHeader: {
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: '700',
  },
  smallRow: {
    flexDirection: 'row',
    gap: 6,
  },
  smallBtn: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  smallBtnText: {
    color: '#38bdf8',
    fontSize: 11,
    fontWeight: '600',
  },
  markdownCode: {
    backgroundColor: '#020617',
    color: '#38bdf8',
    fontFamily: 'monospace',
    fontSize: 10,
    padding: 8,
    borderRadius: 8,
  },
  valItem: {
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  valTitle: {
    color: '#f8fafc',
    fontSize: 12,
    fontWeight: '700',
  },
  valErrorBadge: {
    color: '#4ade80',
    fontSize: 12,
    fontWeight: '800',
  },
  valCoord: {
    color: '#cbd5e1',
    fontSize: 11,
    marginTop: 2,
  },
  valDelta: {
    color: '#fde047',
    fontSize: 11,
    marginTop: 4,
    fontWeight: '600',
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 10,
  },
  statCell: {
    width: '48%',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 8,
  },
  statName: {
    color: '#94a3b8',
    fontSize: 11,
  },
  statVal: {
    color: '#38bdf8',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 2,
  },
  ttlRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 6,
  },
  ttlLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    marginRight: 4,
  },
  ttlChip: {
    backgroundColor: '#1e293b',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#334155',
  },
  ttlChipActive: {
    backgroundColor: 'rgba(56, 189, 248, 0.2)',
    borderColor: '#38bdf8',
  },
  ttlChipText: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: '600',
  },
  ttlChipTextActive: {
    color: '#f8fafc',
  },
  clearCacheBtn: {
    backgroundColor: '#334155',
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 6,
    marginLeft: 'auto',
  },
  clearCacheText: {
    color: '#f87171',
    fontSize: 11,
    fontWeight: '600',
  },
  inputLabel: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 6,
    marginBottom: 4,
  },
  input: {
    backgroundColor: '#1e293b',
    borderWidth: 1,
    borderColor: '#334155',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    color: '#f8fafc',
    fontSize: 12,
  },
  saveBtn: {
    backgroundColor: '#059669',
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  saveBtnText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
  },
  savedText: {
    color: '#34d399',
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
  },
});

