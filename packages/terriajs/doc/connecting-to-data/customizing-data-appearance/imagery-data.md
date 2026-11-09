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
Intervals include the lower edge and exclude the upper edge; the final upper
edge is included. Values below or above the edges use the first or last color.
NaN, nonfinite values, and the TIFF/configured NoData value remain transparent.

An automatic swatch legend describes the clamped intervals. An explicit
`legends` configuration overrides it; `hideLegendInWorkbench` hides it.
Feature picking still uses original measurements. Binned tiles use CPU
classification after the provider's resampling, rather than a GPU color ramp,
so bin boundaries are exact but rendering can be slower. Use nearest-neighbor
resampling to avoid averaging measurements before classification.
As with continuous stretch, reload the item after changing rendering options.

## For more

For more information, check the descriptions under each of the [catalog items](../catalog-items.md) (eg. WMS).
