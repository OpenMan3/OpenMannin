/**
 * Reader-facing layer tree assembly.
 *
 * Splits the flat registry into the two-level category tree and the
 * unthemed group sections. This is pure and lives outside the component so the
 * grouping rules are unit-testable: the important invariant is that every
 * layer lands in exactly one place and none is silently dropped.
 */

import type { LayerCategory, LayerDef, LayerGroup, LayerSubcategory } from "./types";

export interface LayerTree {
  /** category -> subcategory -> layers, insertion-ordered by registry. */
  byCategory: Map<LayerCategory, Map<LayerSubcategory, LayerDef[]>>;
  /** group -> layers, for layers that carry no category. */
  byGroup: Map<LayerGroup, LayerDef[]>;
}

export function buildLayerTree(layers: LayerDef[]): LayerTree {
  const byCategory = new Map<LayerCategory, Map<LayerSubcategory, LayerDef[]>>();
  const byGroup = new Map<LayerGroup, LayerDef[]>();

  for (const l of layers) {
    if (l.category && l.subcategory) {
      if (!byCategory.has(l.category)) byCategory.set(l.category, new Map());
      const subs = byCategory.get(l.category)!;
      if (!subs.has(l.subcategory)) subs.set(l.subcategory, []);
      subs.get(l.subcategory)!.push(l);
    } else {
      if (!byGroup.has(l.group)) byGroup.set(l.group, []);
      byGroup.get(l.group)!.push(l);
    }
  }

  return { byCategory, byGroup };
}
