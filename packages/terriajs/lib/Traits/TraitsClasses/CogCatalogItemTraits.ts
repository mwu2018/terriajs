import objectTrait from "../Decorators/objectTrait";
import primitiveArrayTrait from "../Decorators/primitiveArrayTrait";
import primitiveTrait from "../Decorators/primitiveTrait";
import ModelTraits from "../ModelTraits";
import { traitClass } from "../Trait";
import mixTraits from "../mixTraits";
import CatalogMemberTraits from "./CatalogMemberTraits";
import ImageryProviderTraits from "./ImageryProviderTraits";
import LayerOrderingTraits from "./LayerOrderingTraits";
import LegendOwnerTraits from "./LegendOwnerTraits";
import MappableTraits from "./MappableTraits";
import UrlTraits from "./UrlTraits";

export class CogSingleBandRenderOptionsTraits extends ModelTraits {
  @primitiveTrait({
    type: "number",
    name: "Band",
    description: "The one-based band index to render. Defaults to 1."
  })
  band?: number;

  @primitiveTrait({
    type: "string",
    name: "Band Name",
    description: "The name of the band to render."
  })
  bandName?: string;

  @primitiveArrayTrait({
    type: "number",
    name: "Domain",
    description:
      "Fixed stretch as [minimum, maximum], with two finite values and minimum less than maximum. For custom continuous colors, use either domain or colorStops."
  })
  domain?: number[];

  @primitiveArrayTrait({
    type: "string",
    name: "Continuous colors",
    description:
      "At least two opaque #RRGGBB colors, interpolated linearly in RGB. Requires colorStops or domain and cannot be combined with bins. Values outside the range use the nearest end color."
  })
  colors?: string[];

  @primitiveArrayTrait({
    type: "number",
    name: "Color stops",
    description:
      "Strictly increasing finite sample values, one per continuous color. Supports uneven spacing. Requires colors and cannot be combined with domain or bins."
  })
  colorStops?: number[];

  @primitiveArrayTrait({
    type: "number",
    name: "Bin edges",
    description:
      "Strictly increasing finite bin edges. Requires one binColor per interval. Cannot be combined with domain. Values outside the edges use the nearest end color."
  })
  binEdges?: number[];

  @primitiveArrayTrait({
    type: "string",
    name: "Bin colors",
    description:
      "Opaque colors in #RRGGBB format, one per nominal interval in binEdges. Uses the provider's discrete palette; sampled transitions may differ slightly from exact edges."
  })
  binColors?: string[];

  @primitiveTrait({
    type: "boolean",
    name: "Force Single Value Legend",
    description:
      "Whether to force the legend to show a single value (left bin edge)."
  })
  forceSingleValueLegend?: boolean;
}

export class CogRenderOptionsTraits extends ModelTraits {
  @objectTrait({
    type: CogSingleBandRenderOptionsTraits,
    name: "Single Band",
    description:
      "Single-band rendering options. Do not combine with convertToRGB: true."
  })
  single?: CogSingleBandRenderOptionsTraits;

  @primitiveTrait({
    type: "number",
    name: "No Data Value",
    description: "No data value, default read from tiff meta"
  })
  nodata?: number;

  @primitiveTrait({
    type: "boolean",
    name: "Convert to RGB",
    description: "Try to render multi band cog to RGB, priority 1"
  })
  convertToRGB?: boolean;

  @primitiveTrait({
    type: "string",
    name: "Resample Method",
    description: "Geotiff resample method. Defaults to `bilinear`."
  })
  resampleMethod?: "nearest" | "bilinear" = "nearest";
}

@traitClass({
  description:
    "Creates a Cloud Optimised Geotiff item in the catalog from a url pointing to a TIFF that is a valid COG.",
  example: {
    name: "COG Test Uluru",
    description:
      "This is a COG from Sentinel-2 L2A, in EPSG:32752. Does it display in correct location? Does it display correctly?",
    type: "cog",
    url: "https://sentinel-cogs.s3.us-west-2.amazonaws.com/sentinel-s2-l2a-cogs/52/J/FS/2023/5/S2A_52JFS_20230501_0_L2A/TCI.tif"
  }
})
export default class CogCatalogItemTraits extends mixTraits(
  ImageryProviderTraits,
  LayerOrderingTraits,
  UrlTraits,
  MappableTraits,
  CatalogMemberTraits,
  LegendOwnerTraits
) {
  @objectTrait({
    type: CogRenderOptionsTraits,
    name: "Render Options",
    description: "Render options for COGs"
  })
  renderOptions?: CogRenderOptionsTraits;

  @primitiveTrait({
    type: "string",
    name: "Credit",
    description: "Credit for the imagery provider."
  })
  credit?: string;

  @primitiveTrait({
    type: "number",
    name: "Tile Size",
    description: "The size of the tile."
  })
  tileSize?: number;

  @primitiveTrait({
    type: "boolean",
    name: "Has Alpha Channel",
    description: "Whether the imagery has an alpha channel."
  })
  hasAlphaChannel?: boolean;

  @primitiveTrait({
    type: "number",
    name: "Cache",
    description: "Cache survival time in milliseconds."
  })
  cache?: number;
}
