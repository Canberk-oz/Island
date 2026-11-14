import { BlurMask, Canvas, Group, Path } from '@shopify/react-native-skia';
import React, { useMemo } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { getSpecies } from '../game/species';
import type { TerrainKind } from '../game/types';
import { animalSprite, terrainSprite } from './creatures';
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

interface IconProps {
  variant?: string | null;
  speciesId?: string;
  terrain?: TerrainKind;
  animal?: string;
  size: number;
  cx: number;
  top: number;
  silhouette: boolean;
}

function iconParts({ speciesId, terrain, animal, size, variant }: Pick<IconProps, 'speciesId' | 'terrain' | 'animal' | 'size' | 'variant'>): PlantPart[] {
  if (terrain) {
    const s = terrainSprite(terrain, size * 1.05);
    return [...s.parts, ...(s.spin?.parts ?? []), ...(s.alt ?? [])];
  }
  if (animal) {
    // Measure at a reference size, then fit the animal into the icon.
    const ref = animalSprite(animal, 100);
    if (!ref) return [];
    const unit = (size * 0.82 * 100) / Math.max(ref.width, ref.height);
    const s = animalSprite(animal, unit)!;
    return [...s.parts, ...(s.rest ?? [])];
  }
  const sp = getSpecies(speciesId ?? '');
  // Fit the plant's height into the icon.
  return plantSprite(sp.id, (size * 0.8) / (sp.size * 1.15), 'summer', variant ?? null).parts;
}

function IconDrawing(props: IconProps) {
  const { size, cx, top, silhouette, speciesId, terrain, animal, variant } = props;
  const parts = useMemo(() => iconParts({ speciesId, terrain, animal, size, variant }), [speciesId, terrain, animal, size, variant]);
  return (
    <Group transform={[{ translateX: cx }, { translateY: top + size * 0.93 }]}>
      {silhouette ? (
        <Group opacity={0.22}>
          {parts.map((p, i) =>
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
          <PlantGlow parts={parts} />
          <PlantBody parts={parts} />
        </>
      )}
    </Group>
  );
}

/** A small standalone picture of a species, for cards. */
export function PlantIcon({
  speciesId,
  terrain,
  animal,
  variant,
  size,
  silhouette = false,
  style,
}: {
  variant?: string | null;
  speciesId?: string;
  terrain?: TerrainKind;
  animal?: string;
  size: number;
  silhouette?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Canvas style={StyleSheet.flatten([{ width: size, height: size }, style])}>
      <IconDrawing speciesId={speciesId} terrain={terrain} animal={animal} variant={variant} size={size} cx={size / 2} top={0} silhouette={silhouette} />
    </Canvas>
  );
}

export interface SheetItem {
  /** Exactly one of these says what to draw. */
  speciesId?: string;
  terrain?: TerrainKind;
  animal?: string;
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
  // The wrapping View is what makes the sheet ignore touches: a Skia canvas
  // does not honour pointerEvents itself on every platform, and this sheet
  // usually lies on top of the buttons it decorates.
  return (
    <View pointerEvents="none" style={StyleSheet.flatten([{ width, height }, style])}>
      <Canvas style={{ width, height }}>
        {items.map((it, i) => (
        <IconDrawing
          key={`${it.speciesId ?? it.terrain ?? it.animal}:${i}`}
          speciesId={it.speciesId}
          terrain={it.terrain}
          animal={it.animal}
          size={it.size}
          cx={it.cx}
          top={it.top}
          silhouette={!!it.silhouette}
        />
        ))}
      </Canvas>
    </View>
  );
}
