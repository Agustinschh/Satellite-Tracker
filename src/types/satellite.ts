import type { OMMJsonObject, SatRec } from 'satellite.js';

export type ConstellationGroup =
  | 'stations'
  | 'starlink'
  | 'gps-ops'
  | 'weather'
  | 'geo'
  | 'active';

export type DataProviderId = 'celestrak' | 'spacetrack' | 'n2yo' | 'wheretheiss';

export type OrbitRegime = 'LEO' | 'MEO' | 'GEO' | 'HEO';

export interface TlePair {
  line1: string;
  line2: string;
}

export interface OrbitalRecord {
  noradId: number;
  name: string;
  objectId?: string;
  group?: ConstellationGroup;
  format: 'omm' | 'tle';
  omm?: OMMJsonObject;
  tle?: TlePair;
  /** ISO 8601 UTC timestamp of the orbital element epoch */
  epoch: string;
  /** Mean motion in revolutions per day */
  meanMotion: number;
  /** Inclination in degrees */
  inclination: number;
  /** Eccentricity */
  eccentricity: number;
  source: DataProviderId | 'seed';
  /** Unix timestamp (ms) when this record was fetched/cached */
  fetchedAt: number;
  /** Optional cached SatRec instance */
  satrec?: SatRec;
}

export interface ObserverLocation {
  latitude: number;  // degrees (-90..90)
  longitude: number; // degrees (-180..180)
  altitude: number;  // meters above sea level
  name?: string;
  isManual?: boolean;
}

export interface SubsatellitePoint {
  latitude: number;   // degrees (-90..90)
  longitude: number;  // degrees (-180..180)
  altitudeKm: number; // km above WGS84 ellipsoid
  velocityKms: number; // orbital speed (km/s)
  eciKm: { x: number; y: number; z: number };
  ecefKm: { x: number; y: number; z: number };
  timestamp: number;
}

export interface LookAngles {
  azimuthDeg: number;   // 0..360 (0 = North, 90 = East)
  elevationDeg: number; // -90..90
  rangeKm: number;      // slant range in km
}

export interface TelemetrySnapshot extends SubsatellitePoint, LookAngles {
  noradId: number;
  name: string;
  orbitRegime: OrbitRegime;
  periodMinutes: number;
}

export interface LatLngPoint {
  latitude: number;
  longitude: number;
}

export interface GroundTrackResult {
  pastSegments: LatLngPoint[][];
  futureSegments: LatLngPoint[][];
  periodMinutes: number;
  computedAt: number;
}

export interface FootprintResult {
  polygons: LatLngPoint[][];
  coverageRadiusKm: number;
  centralAngleDeg: number;
  minElevationDeg: number;
}

export interface PassSample {
  timestamp: number;
  azimuthDeg: number;
  elevationDeg: number;
  rangeKm: number;
}

export interface PassWindow {
  id: string;
  noradId: number;
  satName: string;
  aosTime: number;      // Unix ms
  tcaTime: number;      // Unix ms (Time of Closest Approach / Max Elevation)
  losTime: number;      // Unix ms
  durationSec: number;
  aosAzimuthDeg: number;
  maxElevationDeg: number;
  tcaAzimuthDeg: number;
  losAzimuthDeg: number;
  minElevationThresholdDeg: number;
  isGeostationaryVisible?: boolean;
  isOngoing?: boolean;
  samples: PassSample[];
}

export interface ValidationExternalSample {
  provider: 'wheretheiss' | 'n2yo';
  noradId: number;
  timestamp: number; // Unix ms
  latitude: number;
  longitude: number;
  altitudeKm: number;
  velocityKms?: number;
  azimuthDeg?: number;
  elevationDeg?: number;
}

export interface ValidationComparisonResult {
  id: string;
  provider: 'wheretheiss' | 'n2yo';
  noradId: number;
  satName: string;
  timestamp: number;
  local: {
    latitude: number;
    longitude: number;
    altitudeKm: number;
    azimuthDeg: number;
    elevationDeg: number;
  };
  external: ValidationExternalSample;
  errors: {
    deltaLatDeg: number;
    deltaLonDeg: number;
    deltaAltKm: number;
    surfaceDistanceKm: number; // Haversine great-circle distance on Earth surface
    euclidean3dKm: number;     // 3D ECEF Euclidean distance in km
    deltaAzimuthDeg?: number;
    deltaElevationDeg?: number;
  };
  epochIso: string;
  epochAgeHours: number;
}

export interface DataProvider {
  id: DataProviderId;
  name: string;
  requiresAuth: boolean;
  getCatalog?(group: ConstellationGroup): Promise<OrbitalRecord[]>;
  getOrbitalData(noradId: number): Promise<OrbitalRecord>;
  getValidationPosition?(
    noradId: number,
    observer: ObserverLocation
  ): Promise<ValidationExternalSample>;
}

