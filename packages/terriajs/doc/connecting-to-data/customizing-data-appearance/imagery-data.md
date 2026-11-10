# Imagery Data

**Warning: This section needs to be updated for TerriaJS version 8.**

## Overview

Here's an example json file which places some sample WMS items in an open group called "WMS example", at the top of the catalog:

```json
{
  "catalog": [
    {
      "name": "WMS example",
      "type": "group",
      "isPromoted": true,
      "isOpen": true,
      "items": [
        {
          "name": "Solar Satellite DNI & GHI with datetime picker",
          "layers": "Solar_Satellite_DNI_2014",
          "url": "http://gis.aremi.nationalmap.gov.au/bom/wms",
          "type": "wms",
          "maxRefreshIntervals": 9000,
          "showDatetimePicker": true,
          "useOwnClock": true,
          "featureInfoTemplate": {
            "name": "{{GRAY_INDEX}} W/m2"
          }
        },
        {
          "name": "Solar Satellite DNI & GHI with initialTimeSource",
          "layers": "Solar_Satellite_DNI_2014",
          "url": "http://gis.aremi.nationalmap.gov.au/bom/wms",
          "type": "wms",
          "maxRefreshIntervals": 9000,
          "initialTimeSource": "2014-06-30T22:00:00Z",
          "featureInfoTemplate": {
            "name": "{{GRAY_INDEX}} W/m2"
          }
        }
      ]
    }
  ]
}
```

## Setting the default date

Use `initialTimeSource` to do this. The allowed values are a valid ISO8601 datestring, "present", "start" and "end".

## Fixed grayscale stretch for COGs

Use `renderOptions.single` on a `cog` item to select a band and a fixed
grayscale stretch:

```json
{
  "type": "cog",
  "name": "Raster with a fixed stretch",
  "url": "https://example.com/data.tif",
  "renderOptions": {
    "single": {
      "band": 1,
      "domain": [-70, 50]
    }
  }
}
```

Band indices start at 1; omitting `band` selects band 1. The domain must contain
exactly two finite numbers, with the minimum less than the maximum. Omit
`domain` to let the provider determine the range from the TIFF. Do not combine
single-band options with `convertToRGB: true`.

Use the same domain on both items to compare their grayscale appearance.
This controls display only: it does not change pixel measurements, NoData
handling, or automatically generate a legend. The options are applied when the
imagery provider is loaded; they do not add an interactive stretch control.

## Continuous color ramps for COGs

Set `renderOptions.single.colors` and `colorStops` to colorize a single band:

```json
{
  "type": "cog",
  "name": "Continuous colored raster",
  "url": "https://example.com/data.tif",
  "renderOptions": {
    "nodata": -9999,
    "single": {
      "band": 1,
      "colorStops": [-70, 0, 50],
      "colors": ["#0000ff", "#ffffff", "#ff0000"]
    }
  }
}
```

Provide at least two opaque `#RRGGBB` colors and one finite numeric stop per
color. Stops must be strictly increasing and may be unevenly spaced.
Colors are interpolated linearly per RGB channel between consecutive stops.
In this example, -70 is blue, 0 is white, and 50 is red.
Values outside the stop range use the nearest endpoint color. NoData masking
is handled by the TIFF provider. Original pixel measurements are preserved for
feature picking.

Use the same stops and colors on both items for visual comparison. Do not
combine `colors` with `binEdges`, `binColors`, or `convertToRGB: true`.
Do not combine `colorStops` with `domain`. For compatibility, specifying
`domain` instead of `colorStops` still spaces colors evenly across that domain.
Omitting `colors` preserves the existing grayscale stretch.

A gradient legend with endpoint labels is generated automatically. Explicit
`legends` override it; `hideLegendInWorkbench` hides it. The generated legend
uses an SVG data URL, so deployment content security policy must allow data
images. Avoid `forceProxy: true` with this legend, or supply a hosted legend.
Like bins, ramps are passed directly to the TIFF provider as value/color pairs
with `useRealValue: true`, clamping, and `type: "continuous"`. The provider
renders the style using WebGL; TerriaJS does not override its renderer.
Palette sampling can cause small differences from exact RGB interpolation.
Custom color styles require WebGL with floating-point texture support. If it is
unavailable, the item reports a load error instead of using the provider's
incorrectly clamped CPU palette fallback. Enable browser hardware acceleration
or use an unstyled grayscale item.
Reload the item after changing rendering options.

## Discrete grayscale bins for COGs

Use the same edges and colors on both rasters to compare discrete classes:

```json
{
  "type": "cog",
  "name": "Binned raster",
  "url": "https://example.com/data.tif",
  "renderOptions": {
    "nodata": -9999,
    "single": {
      "band": 1,
      "binEdges": [-70, -40, -10, 20, 50],
      "binColors": ["#000000", "#555555", "#aaaaaa", "#ffffff"]
    }
  }
}
```

Edges must be finite and strictly increasing, with one opaque `#RRGGBB`
color per interval. Grayscale and RGB palettes are supported. For blue shades,
use `["#eff3ff", "#bdd7e7", "#6baed6", "#2171b5"]` in the example above.
Do not combine bins with `domain` or `convertToRGB: true`.
The configured edges describe lower-inclusive, upper-exclusive intervals,
with the final upper edge included. Values below or above the edges use the
first or last color. Bins are passed to the provider as lower-edge/color pairs
with `useRealValue: true` and `type: "discrete"`. Its finite-resolution palette
can shift transitions slightly, so bins are not exact numeric threshold
classifications. The legend describes the configured, nominal boundaries.

An automatic swatch legend describes the clamped intervals. An explicit
`legends` configuration overrides it; `hideLegendInWorkbench` hides it.
Feature picking still uses original measurements. Rendering and NoData
masking use the provider's native WebGL implementation, including its
browser/GPU limitations. As with continuous colors, WebGL is required and a
load error is reported if it is unavailable.
In particular, NaN masking may fail in Chrome;
for affected datasets replace NaN with a finite NoData sentinel and declare
that sentinel in the TIFF or `renderOptions.nodata`.
Use nearest-neighbor resampling to avoid averaging measurements before
palette mapping.
As with continuous stretch, reload the item after changing rendering options.

## For more

For more information, check the descriptions under each of the [catalog items](../catalog-items.md) (eg. WMS).
