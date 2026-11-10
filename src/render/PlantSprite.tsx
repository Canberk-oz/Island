import { BlurMask, Canvas, Group, Path } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { getSpecies } from '../game/species';
import { plantSprite, type PlantPart } from './plants';

function PartPath({ part, wiltedLook }: { part: PlantPart; wiltedLook: boolean }) {
  const color = wiltedLook ? part.wiltColor : part.color;
  if (part.stroke != null) {
    return (
      <Path
        path={part.path}
        color={color}
        style="stroke"
        strokeWidth={part.stroke}
        strokeCap="round"
        strokeJoin="round"
        opacity={part.opacity ?? 1}
      />
    );
  }
  return <Path path={part.path} color={color} opacity={part.opacity ?? 1} />;
}

/** The solid parts of a plant, in fresh or wilted colours. Must be used inside a Canvas. */
export function PlantBody({ parts, wiltedLook = false }: { parts: PlantPart[]; wiltedLook?: boolean }) {
  return (
    <>
      {parts.map((p, i) => (p.blur == null ? <PartPath key={i} part={p} wiltedLook={wiltedLook} /> : null))}
    </>
  );
}

/** The blurred glow of legendary plants. Must be used inside a Canvas. */
export function PlantGlow({ parts }: { parts: PlantPart[] }) {
  return (
    <>
      {parts.map((p, i) =>
        p.blur != null ? (
          <Path key={i} path={p.path} color={p.color} opacity={p.opacity ?? 1}>
            <BlurMask blur={p.blur} style="normal" />
          </Path>
        ) : null,
      )}
    </>
  );
}

export function hasGlow(parts: PlantPart[]) {
  return parts.some((p) => p.blur != null);
}

function IconDrawing({ speciesId, size, cx, top, silhouette }: { speciesId: string; size: number; cx: number; top: number; silhouette: boolean }) {
  const sprite = useMemo(() => {
    const s = getSpecies(speciesId);
    // Fit the plant's height into the icon.
    return plantSprite(speciesId, (size * 0.8) / (s.size * 1.15));
  }, [speciesId, size]);
  return (
    <Group transform={[{ translateX: cx }, { translateY: top + size * 0.93 }]}>
      {silhouette ? (
        <Group opacity={0.22}>
          {sprite.parts.map((p, i) =>
            p.blur == null ? (
              <Path
                key={i}
                path={p.path}
                color="#1F3D2B"
                style={p.stroke != null ? 'stroke' : 'fill'}
                strokeWidth={p.stroke ?? 0}
                strokeCap="round"
              />
            ) : null,
          )}
        </Group>
      ) : (
        <>
          <PlantGlow parts={sprite.parts} />
          <PlantBody parts={sprite.parts} />
        </>
      )}
    </Group>
  );
}

/** A small standalone picture of a species, for cards. */
export function PlantIcon({
  speciesId,
  size,
  silhouette = false,
  style,
}: {
  speciesId: string;
  size: number;
  silhouette?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Canvas style={StyleSheet.flatten([{ width: size, height: size }, style])}>
      <IconDrawing speciesId={speciesId} size={size} cx={size / 2} top={0} silhouette={silhouette} />
    </Canvas>
  );
}

export interface SheetItem {
  speciesId: string;
  /** Centre x and top y of the icon inside the sheet. */
  cx: number;
  top: number;
  size: number;
  silhouette?: boolean;
}

/**
 * Many plant icons drawn into one canvas. Lists use this instead of one
 * canvas per item: a single GPU surface is far cheaper than dozens.
 */
export function PlantSheet({ width, height, items, style }: { width: number; height: number; items: SheetItem[]; style?: StyleProp<ViewStyle> }) {
  return (
    <Canvas style={StyleSheet.flatten([{ width, height }, style])} pointerEvents="none">
      {items.map((it, i) => (
        <IconDrawing key={`${it.speciesId}:${i}`} speciesId={it.speciesId} size={it.size} cx={it.cx} top={it.top} silhouette={!!it.silhouette} />
      ))}
    </Canvas>
  );
}
