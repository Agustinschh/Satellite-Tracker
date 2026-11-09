import React from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  G,
  Line,
  Path,
  Text as SvgText,
} from 'react-native-svg';
import { degreesToRadians } from 'satellite.js';
import type { LookAngles, PassWindow } from '../../types/satellite';

interface Props {
  size?: number;
  pass?: PassWindow | null;
  liveLook?: LookAngles | null;
  minElevationDeg?: number;
  deviceHeadingDeg?: number;
  rotateWithCompass?: boolean;
}

/**
 * Converts polar look angles (Azimuth 0..360°, Elevation 0..90°) into (x, y) SVG coordinates.
 * Zenith (90° elevation) is at center (cx, cy); Horizon (0° elevation) is at radius R.
 */
export function polarToCartesian(
  azimuthDeg: number,
  elevationDeg: number,
  cx: number,
  cy: number,
  maxRadius: number
): { x: number; y: number } {
  const clampedEl = Math.max(0, Math.min(90, elevationDeg));
  const r = maxRadius * (1 - clampedEl / 90);
  const azRad = degreesToRadians(azimuthDeg);

  return {
    x: cx + r * Math.sin(azRad),
    y: cy - r * Math.cos(azRad),
  };
}

export const PolarSkyChart: React.FC<Props> = ({
  size = 300,
  pass,
  liveLook,
  minElevationDeg = 10,
  deviceHeadingDeg = 0,
  rotateWithCompass = false,
}) => {
  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = size / 2 - 28;

  const r30 = maxRadius * (1 - 30 / 90);
  const r60 = maxRadius * (1 - 60 / 90);
  const rMinEl = maxRadius * (1 - Math.max(0, Math.min(89, minElevationDeg)) / 90);

  // Build SVG path for the selected pass trajectory
  let trajectoryPath = '';
  let aosPoint: { x: number; y: number } | null = null;
  let tcaPoint: { x: number; y: number } | null = null;
  let losPoint: { x: number; y: number } | null = null;

  if (pass && pass.samples.length > 0) {
    const coords = pass.samples.map((s) =>
      polarToCartesian(s.azimuthDeg, s.elevationDeg, cx, cy, maxRadius)
    );
    trajectoryPath = coords
      .map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`)
      .join(' ');

    aosPoint = polarToCartesian(pass.aosAzimuthDeg, pass.minElevationThresholdDeg, cx, cy, maxRadius);
    tcaPoint = polarToCartesian(pass.tcaAzimuthDeg, pass.maxElevationDeg, cx, cy, maxRadius);
    losPoint = polarToCartesian(pass.losAzimuthDeg, pass.minElevationThresholdDeg, cx, cy, maxRadius);
  }

  const livePoint =
    liveLook && liveLook.elevationDeg >= 0
      ? polarToCartesian(liveLook.azimuthDeg, liveLook.elevationDeg, cx, cy, maxRadius)
      : null;

  const rotation = rotateWithCompass ? -deviceHeadingDeg : 0;

  return (
    <View style={styles.wrapper}>
      <Svg width={size} height={size}>
        <G transform={`rotate(${rotation}, ${cx}, ${cy})`}>
          {/* Horizon and concentric elevation rings */}
          <Circle
            cx={cx}
            cy={cy}
            r={maxRadius}
            fill="#0b132b"
            stroke="#334155"
            strokeWidth={2}
          />
          <Circle
            cx={cx}
            cy={cy}
            r={rMinEl}
            fill="rgba(56, 189, 248, 0.05)"
            stroke="#0284c7"
            strokeWidth={1}
            strokeDasharray="4,4"
          />
          <Circle
            cx={cx}
            cy={cy}
            r={r30}
            fill="none"
            stroke="#1e293b"
            strokeWidth={1}
          />
          <Circle
            cx={cx}
            cy={cy}
            r={r60}
            fill="none"
            stroke="#1e293b"
            strokeWidth={1}
          />

          {/* Crosshair cardinal axes */}
          <Line
            x1={cx}
            y1={cy - maxRadius}
            x2={cx}
            y2={cy + maxRadius}
            stroke="#1e293b"
            strokeWidth={1}
          />
          <Line
            x1={cx - maxRadius}
            y1={cy}
            x2={cx + maxRadius}
            y2={cy}
            stroke="#1e293b"
            strokeWidth={1}
          />

          {/* Elevation degree labels */}
          <SvgText x={cx + 4} y={cy - r30 + 12} fill="#64748b" fontSize="10">
            30°
          </SvgText>
          <SvgText x={cx + 4} y={cy - r60 + 12} fill="#64748b" fontSize="10">
            60°
          </SvgText>
          <SvgText x={cx + 4} y={cy - rMinEl - 3} fill="#38bdf8" fontSize="9">
            Umbral {minElevationDeg}°
          </SvgText>

          {/* Cardinal Labels */}
          <SvgText
            x={cx}
            y={cy - maxRadius - 8}
            fill="#f87171"
            fontSize="13"
            fontWeight="bold"
            textAnchor="middle"
          >
            N
          </SvgText>
          <SvgText
            x={cx + maxRadius + 14}
            y={cy + 4}
            fill="#94a3b8"
            fontSize="12"
            fontWeight="bold"
            textAnchor="middle"
          >
            E
          </SvgText>
          <SvgText
            x={cx}
            y={cy + maxRadius + 18}
            fill="#94a3b8"
            fontSize="12"
            fontWeight="bold"
            textAnchor="middle"
          >
            S
          </SvgText>
          <SvgText
            x={cx - maxRadius - 14}
            y={cy + 4}
            fill="#94a3b8"
            fontSize="12"
            fontWeight="bold"
            textAnchor="middle"
          >
            O
          </SvgText>

          {/* Pass Trajectory Curve */}
          {trajectoryPath !== '' && (
            <Path
              d={trajectoryPath}
              fill="none"
              stroke="#38bdf8"
              strokeWidth={3}
            />
          )}

          {/* AOS, TCA (Max), and LOS markers */}
          {aosPoint && (
            <G>
              <Circle cx={aosPoint.x} cy={aosPoint.y} r={5} fill="#22c55e" />
              <SvgText
                x={aosPoint.x + 7}
                y={aosPoint.y + 4}
                fill="#4ade80"
                fontSize="10"
                fontWeight="bold"
              >
                AOS
              </SvgText>
            </G>
          )}

          {tcaPoint && (
            <G>
              <Circle cx={tcaPoint.x} cy={tcaPoint.y} r={6} fill="#facc15" />
              <SvgText
                x={tcaPoint.x + 8}
                y={tcaPoint.y - 4}
                fill="#fde047"
                fontSize="10"
                fontWeight="bold"
              >
                MAX {pass?.maxElevationDeg.toFixed(0)}°
              </SvgText>
            </G>
          )}

          {losPoint && (
            <G>
              <Circle cx={losPoint.x} cy={losPoint.y} r={5} fill="#ef4444" />
              <SvgText
                x={losPoint.x + 7}
                y={losPoint.y + 4}
                fill="#f87171"
                fontSize="10"
                fontWeight="bold"
              >
                LOS
              </SvgText>
            </G>
          )}

          {/* Live satellite instantaneous position (if above horizon) */}
          {livePoint && (
            <G>
              <Circle
                cx={livePoint.x}
                cy={livePoint.y}
                r={10}
                fill="rgba(244, 63, 94, 0.28)"
              />
              <Circle
                cx={livePoint.x}
                cy={livePoint.y}
                r={5}
                fill="#f43f5e"
                stroke="#ffffff"
                strokeWidth={1.5}
              />
            </G>
          )}
        </G>
      </Svg>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    alignItems: 'center',
    justifyContent: 'center',
  },
});

