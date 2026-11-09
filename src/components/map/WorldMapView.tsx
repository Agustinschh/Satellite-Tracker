import React, { useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import type {
  FootprintResult,
  GroundTrackResult,
  LatLngPoint,
  ObserverLocation,
  TelemetrySnapshot,
} from '../../types/satellite';

// Conditionally require react-native-maps on native platforms (Android / iOS)
const NativeMaps =
  Platform.OS !== 'web'
    ? // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('react-native-maps')
    : null;

interface Props {
  telemetry: TelemetrySnapshot | null;
  observer: ObserverLocation;
  groundTrack: GroundTrackResult | null;
  footprint: FootprintResult | null;
  constellationSnapshots: TelemetrySnapshot[];
  showGroundTrack: boolean;
  showFootprint: boolean;
  showConstellation: boolean;
  onSelectConstellationSat?: (noradId: number) => void;
}

function latLonToSvg(
  lat: number,
  lon: number,
  width: number,
  height: number
): { x: number; y: number } {
  const x = ((lon + 180) / 360) * width;
  const y = ((90 - lat) / 180) * height;
  return { x, y };
}

function segmentToSvgPath(seg: LatLngPoint[], width: number, height: number): string {
  return seg
    .map((pt, idx) => {
      const { x, y } = latLonToSvg(pt.latitude, pt.longitude, width, height);
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');
}

// Simplified continental outlines in (lat, lon) so the SVG Tactical Map always shows continents clearly
const CONTINENT_POLYGONS: LatLngPoint[][] = [
  // South America
  [
    { latitude: 12, longitude: -72 },
    { latitude: 8, longitude: -60 },
    { latitude: -5, longitude: -35 },
    { latitude: -23, longitude: -43 },
    { latitude: -38, longitude: -57 },
    { latitude: -55, longitude: -68 },
    { latitude: -42, longitude: -74 },
    { latitude: -18, longitude: -71 },
    { latitude: -5, longitude: -81 },
    { latitude: 9, longitude: -79 },
    { latitude: 12, longitude: -72 },
  ],
  // North America
  [
    { latitude: 15, longitude: -92 },
    { latitude: 25, longitude: -80 },
    { latitude: 45, longitude: -62 },
    { latitude: 70, longitude: -65 },
    { latitude: 70, longitude: -165 },
    { latitude: 55, longitude: -130 },
    { latitude: 32, longitude: -117 },
    { latitude: 15, longitude: -92 },
  ],
  // Europe & Africa
  [
    { latitude: 36, longitude: -9 },
    { latitude: 43, longitude: -9 },
    { latitude: 60, longitude: 5 },
    { latitude: 70, longitude: 28 },
    { latitude: 50, longitude: 40 },
    { latitude: 31, longitude: 32 },
    { latitude: 12, longitude: 51 },
    { latitude: -35, longitude: 20 },
    { latitude: -15, longitude: 12 },
    { latitude: 5, longitude: 9 },
    { latitude: 5, longitude: -8 },
    { latitude: 15, longitude: -17 },
    { latitude: 35, longitude: -6 },
    { latitude: 36, longitude: -9 },
  ],
  // Asia
  [
    { latitude: 31, longitude: 32 },
    { latitude: 70, longitude: 40 },
    { latitude: 72, longitude: 140 },
    { latitude: 60, longitude: 170 },
    { latitude: 35, longitude: 140 },
    { latitude: 22, longitude: 114 },
    { latitude: 1, longitude: 104 },
    { latitude: 8, longitude: 77 },
    { latitude: 25, longitude: 56 },
    { latitude: 31, longitude: 32 },
  ],
  // Australia
  [
    { latitude: -12, longitude: 130 },
    { latitude: -15, longitude: 145 },
    { latitude: -28, longitude: 153 },
    { latitude: -38, longitude: 145 },
    { latitude: -34, longitude: 115 },
    { latitude: -22, longitude: 114 },
    { latitude: -12, longitude: 130 },
  ],
];

export const WorldMapView: React.FC<Props> = ({
  telemetry,
  observer,
  groundTrack,
  footprint,
  constellationSnapshots,
  showGroundTrack,
  showFootprint,
  showConstellation,
  onSelectConstellationSat,
}) => {
  const [useNativeGoogleMap, setUseNativeGoogleMap] = useState<boolean>(Platform.OS === 'ios');

  const renderModeSwitcher = () => {
    if (Platform.OS === 'web' || !NativeMaps) return null;
    return (
      <TouchableOpacity
        style={styles.modeSwitchBtn}
        onPress={() => setUseNativeGoogleMap((v) => !v)}
      >
        <Text style={styles.modeSwitchText}>
          {useNativeGoogleMap ? '🗺️ Cambiar a Mapa Táctico SGP4' : '🌍 Cambiar a Google Maps Nativo'}
        </Text>
      </TouchableOpacity>
    );
  };

  // Native iOS / Android MapView via react-native-maps
  if (Platform.OS !== 'web' && NativeMaps && useNativeGoogleMap) {
    const MapView = NativeMaps.default;
    const { Marker, Polyline, Polygon } = NativeMaps;

    return (
      <View style={styles.mapContainer}>
        <MapView
          style={StyleSheet.absoluteFillObject}
          initialRegion={{
            latitude: telemetry?.latitude ?? observer.latitude,
            longitude: telemetry?.longitude ?? observer.longitude,
            latitudeDelta: 85,
            longitudeDelta: 85,
          }}
          userInterfaceStyle="dark"
        >
          {/* Observer GPS Marker */}
          <Marker
            coordinate={{
              latitude: observer.latitude,
              longitude: observer.longitude,
            }}
            title={observer.name || 'Observador GPS'}
            description={`Lat ${observer.latitude.toFixed(2)}°, Lon ${observer.longitude.toFixed(2)}°`}
            pinColor="#22c55e"
          />

          {/* Footprint Coverage Polygons (RF-12) */}
          {showFootprint &&
            footprint?.polygons.map((ring, idx) => (
              <Polygon
                key={`fp_${idx}`}
                coordinates={ring}
                strokeColor="rgba(56, 189, 248, 0.85)"
                fillColor="rgba(56, 189, 248, 0.16)"
                strokeWidth={1.5}
              />
            ))}

          {/* Past Ground Track Segments (antimeridian-safe, dashed) (RF-11) */}
          {showGroundTrack &&
            groundTrack?.pastSegments.map((seg, idx) => (
              <Polyline
                key={`past_${idx}`}
                coordinates={seg}
                strokeColor="#94a3b8"
                strokeWidth={2}
                lineDashPattern={[6, 4]}
              />
            ))}

          {/* Future Ground Track Segments (antimeridian-safe, solid) (RF-11) */}
          {showGroundTrack &&
            groundTrack?.futureSegments.map((seg, idx) => (
              <Polyline
                key={`fut_${idx}`}
                coordinates={seg}
                strokeColor="#facc15"
                strokeWidth={2.5}
              />
            ))}

          {/* Starlink Constellation Layer (lightweight markers with tracksViewChanges=false) (RF-13) */}
          {showConstellation &&
            constellationSnapshots.map((sat) => (
              <Marker
                key={`const_${sat.noradId}`}
                coordinate={{ latitude: sat.latitude, longitude: sat.longitude }}
                title={`${sat.name} (#${sat.noradId})`}
                description={`Alt: ${sat.altitudeKm.toFixed(0)} km · El: ${sat.elevationDeg.toFixed(1)}°`}
                tracksViewChanges={false}
                pinColor="#a855f7"
                onPress={() => onSelectConstellationSat?.(sat.noradId)}
              />
            ))}

          {/* Active Selected Satellite Real-Time Marker (RF-10) */}
          {telemetry && (
            <Marker
              coordinate={{
                latitude: telemetry.latitude,
                longitude: telemetry.longitude,
              }}
              title={`🛰️ ${telemetry.name} (${telemetry.noradId})`}
              description={`Alt ${telemetry.altitudeKm.toFixed(1)} km · Vel ${telemetry.velocityKms.toFixed(2)} km/s`}
              pinColor="#f43f5e"
            />
          )}
        </MapView>
        {renderModeSwitcher()}
      </View>
    );
  }

  // Tactical SVG World Map Projection (works without Google Maps API Key on Android & Web)
  const width = 720;
  const height = 360;
  const obsPt = latLonToSvg(observer.latitude, observer.longitude, width, height);
  const satPt = telemetry
    ? latLonToSvg(telemetry.latitude, telemetry.longitude, width, height)
    : null;

  return (
    <View style={styles.webMapWrapper}>
      <Svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`}>
        <Rect x={0} y={0} width={width} height={height} fill="#071022" />

        {/* Continents background */}
        {CONTINENT_POLYGONS.map((poly, idx) => (
          <Path
            key={`cont_${idx}`}
            d={segmentToSvgPath(poly, width, height)}
            fill="#112240"
            stroke="#1e3a5f"
            strokeWidth={1.2}
          />
        ))}

        {/* Graticule grid lines every 30 degrees */}
        {[-60, -30, 0, 30, 60].map((lat) => {
          const { y } = latLonToSvg(lat, 0, width, height);
          return (
            <Line
              key={`lat_${lat}`}
              x1={0}
              y1={y}
              x2={width}
              y2={y}
              stroke={lat === 0 ? '#1e3a5f' : '#13233f'}
              strokeWidth={lat === 0 ? 1.5 : 1}
            />
          );
        })}
        {[-120, -60, 0, 60, 120].map((lon) => {
          const { x } = latLonToSvg(0, lon, width, height);
          return (
            <Line
              key={`lon_${lon}`}
              x1={x}
              y1={0}
              x2={x}
              y2={height}
              stroke={lon === 0 ? '#1e3a5f' : '#13233f'}
              strokeWidth={lon === 0 ? 1.5 : 1}
            />
          );
        })}

        {/* Footprint polygons */}
        {showFootprint &&
          footprint?.polygons.map((seg, idx) => (
            <Path
              key={`wfp_${idx}`}
              d={segmentToSvgPath(seg, width, height)}
              fill="rgba(56, 189, 248, 0.18)"
              stroke="#38bdf8"
              strokeWidth={1.8}
            />
          ))}

        {/* Past Ground Track */}
        {showGroundTrack &&
          groundTrack?.pastSegments.map((seg, idx) => (
            <Path
              key={`wpast_${idx}`}
              d={segmentToSvgPath(seg, width, height)}
              fill="none"
              stroke="#94a3b8"
              strokeWidth={1.8}
              strokeDasharray="6,4"
            />
          ))}

        {/* Future Ground Track */}
        {showGroundTrack &&
          groundTrack?.futureSegments.map((seg, idx) => (
            <Path
              key={`wfut_${idx}`}
              d={segmentToSvgPath(seg, width, height)}
              fill="none"
              stroke="#facc15"
              strokeWidth={2.3}
            />
          ))}

        {/* Constellation Layer */}
        {showConstellation &&
          constellationSnapshots.map((sat) => {
            const pt = latLonToSvg(sat.latitude, sat.longitude, width, height);
            return (
              <Circle
                key={`wconst_${sat.noradId}`}
                cx={pt.x}
                cy={pt.y}
                r={3.2}
                fill="#c084fc"
                onPress={() => onSelectConstellationSat?.(sat.noradId)}
              />
            );
          })}

        {/* Observer Marker */}
        <G>
          <Circle cx={obsPt.x} cy={obsPt.y} r={6} fill="#22c55e" stroke="#ffffff" strokeWidth={1.2} />
          <SvgText x={obsPt.x + 8} y={obsPt.y + 4} fill="#4ade80" fontSize="11" fontWeight="bold">
            OBS
          </SvgText>
        </G>

        {/* Active Satellite Marker */}
        {satPt && telemetry && (
          <G>
            <Circle cx={satPt.x} cy={satPt.y} r={14} fill="rgba(244, 63, 94, 0.28)" />
            <Circle cx={satPt.x} cy={satPt.y} r={6.5} fill="#f43f5e" stroke="#fff" strokeWidth={2} />
            <SvgText
              x={satPt.x + 10}
              y={satPt.y - 7}
              fill="#ffffff"
              fontSize="12"
              fontWeight="bold"
            >
              {telemetry.name}
            </SvgText>
          </G>
        )}
      </Svg>
      {renderModeSwitcher()}
      <View style={styles.legendBar}>
        <Text style={styles.legendItem}>🔴 Satélite Activo</Text>
        <Text style={styles.legendItem}>🟡 Track Futuro</Text>
        <Text style={styles.legendItem}>⚪ Track Pasado</Text>
        <Text style={styles.legendItem}>🔵 Footprint</Text>
        <Text style={styles.legendItem}>🟣 Starlink</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  mapContainer: {
    flex: 1,
    minHeight: 280,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  webMapWrapper: {
    height: 300,
    backgroundColor: '#071022',
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#1e293b',
  },
  modeSwitchBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(15, 23, 42, 0.88)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#38bdf8',
  },
  modeSwitchText: {
    color: '#38bdf8',
    fontSize: 10,
    fontWeight: '700',
  },
  legendBar: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    right: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  legendItem: {
    color: '#cbd5e1',
    fontSize: 10,
    fontWeight: '600',
  },
});
