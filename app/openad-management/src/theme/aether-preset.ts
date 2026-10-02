import Aura from '@primeuix/themes/aura';
import { definePreset, palette } from '@primeuix/themes';
import type { PaletteDesignToken } from '@primeuix/themes/types';

/**
 * OpenAD management panel — Aether design system.
 * Light: designs/management-panel/aether_dooh (Precision Atmosphere)
 * Dark: designs/management-panel/aether_obsidian (Technical Luminescence)
 *
 * Only **anchor** hex values from the design docs appear here. All primary and
 * surface steps use `palette()` from `@primeuix/themes` (see MCP theming guide:
 * “Palette — Returns shades and tints of a given color from 50 to 950”).
 */
export const AETHER_ANCHORS = {
  /** DOOH: brand primary / online status (`primary` in docs) */
  primary: '#006788',
  /**
   * Light mode: cool slate neutral for surfaces (aligned with `on_surface` /
   * editorial grays in aether_dooh).
   */
  surfaceLight: '#475569',
  /** Obsidian: base `surface` / deep void */
  surfaceDark: '#060e20',
} as const;

const primaryPalette = palette(AETHER_ANCHORS.primary) as PaletteDesignToken;
const lightSurfacePalette = palette(
  AETHER_ANCHORS.surfaceLight
) as PaletteDesignToken;
const darkSurfaceGenerated = palette(
  AETHER_ANCHORS.surfaceDark
) as Record<string, string>;

/** Dark UI uses the same generated scale; `0` is an elevated canvas (from the scale, not a new hex). */
const darkSurfacePalette: PaletteDesignToken = {
  0: darkSurfaceGenerated['400'],
  ...darkSurfaceGenerated,
};

export const AetherPreset = definePreset(Aura, {
  semantic: {
    primary: primaryPalette,
    colorScheme: {
      light: {
        surface: {
          0: '#ffffff',
          ...lightSurfacePalette,
        },
        primary: {
          color: '{primary.500}',
          contrastColor: '#ffffff',
          hoverColor: '{primary.600}',
          activeColor: '{primary.700}',
        },
        formField: {
          background: '{surface.100}',
          filledBackground: '{surface.100}',
          filledHoverBackground: '{surface.100}',
          filledFocusBackground: '{surface.100}',
          borderColor: '{surface.300}',
          focusBorderColor: '{primary.color}',
          focusRing: {
            width: '2px',
            style: 'solid',
            color: 'color-mix(in srgb, {primary.color} 30%, transparent)',
            offset: '0',
            shadow: 'none',
          },
        },
        content: {
          background: '{surface.0}',
          borderColor: '{surface.200}',
        },
        text: {
          color: '{surface.900}',
          mutedColor: '{surface.700}',
        },
        overlay: {
          modal: {
            shadow:
              '0 8px 24px color-mix(in srgb, {surface.900} 6%, transparent)',
          },
        },
      },
      dark: {
        surface: darkSurfacePalette,
        primary: {
          color: '{primary.300}',
          contrastColor: '{surface.950}',
          hoverColor: '{primary.200}',
          activeColor: '{primary.100}',
        },
        highlight: {
          background: 'color-mix(in srgb, {primary.color} 20%, transparent)',
          focusBackground:
            'color-mix(in srgb, {primary.color} 30%, transparent)',
          color: '{surface.100}',
          focusColor: '{surface.50}',
        },
        formField: {
          background: '{surface.300}',
          filledBackground: '{surface.300}',
          filledHoverBackground: '{surface.400}',
          filledFocusBackground: '{surface.400}',
          borderColor: '{surface.500}',
          focusBorderColor: '{primary.color}',
          color: '{surface.100}',
          focusRing: {
            width: '1px',
            style: 'solid',
            color: 'color-mix(in srgb, {primary.color} 50%, transparent)',
            offset: '0',
            shadow: 'none',
          },
        },
        content: {
          background: '{surface.800}',
          borderColor: '{surface.600}',
        },
        text: {
          color: '{surface.100}',
          mutedColor: '{surface.400}',
        },
        overlay: {
          modal: {
            shadow: '0 12px 40px rgba(0, 0, 0, 0.5)',
          },
        },
      },
    },
  },
});
