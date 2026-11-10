import i18next from "i18next";
import {
  computed,
  makeObservable,
  observable,
  onBecomeObserved,
  onBecomeUnobserved,
  runInAction
} from "mobx";
import GeographicTilingScheme from "terriajs-cesium/Source/Core/GeographicTilingScheme";
import CesiumMath from "terriajs-cesium/Source/Core/Math";
import WebMercatorTilingScheme from "terriajs-cesium/Source/Core/WebMercatorTilingScheme";
import type TIFFImageryProvider from "terriajs-tiff-imagery-provider";
import type { SingleBandRenderOptions } from "terriajs-tiff-imagery-provider";
import TerriaError from "../../../Core/TerriaError";
import CatalogMemberMixin from "../../../ModelMixins/CatalogMemberMixin";
import MappableMixin, { MapItem } from "../../../ModelMixins/MappableMixin";
import CogCatalogItemTraits from "../../../Traits/TraitsClasses/CogCatalogItemTraits";
import { RectangleTraits } from "../../../Traits/TraitsClasses/MappableTraits";
import LegendTraits, {
  LegendItemTraits
} from "../../../Traits/TraitsClasses/LegendTraits";
import CreateModel from "../../Definition/CreateModel";
import createStratumInstance from "../../Definition/createStratumInstance";
import LoadableStratum from "../../Definition/LoadableStratum";
import { BaseModel } from "../../Definition/Model";
import StratumFromTraits from "../../Definition/StratumFromTraits";
import StratumOrder from "../../Definition/StratumOrder";
import Terria from "../../Terria";
import proxyCatalogItemUrl from "../proxyCatalogItemUrl";

/**
 * Loadable stratum for overriding CogCatalogItem traits
 */
class CogLoadableStratum extends LoadableStratum(CogCatalogItemTraits) {
  static stratumName = "cog-loadable-stratum";

  constructor(readonly model: CogCatalogItem) {
    super();
    makeObservable(this);
  }

  duplicateLoadableStratum(model: BaseModel): this {
    return new CogLoadableStratum(model as CogCatalogItem) as this;
  }

  @computed
  get shortReport(): string | undefined {
    return this.model.terria.currentViewer.type === "Leaflet"
      ? // Warn for 2D mode
        i18next.t(($) => $.models.commonModelErrors["3dTypeIn2dMode"])
      : this.model._imageryProvider?.tilingScheme &&
          // Show warning for experimental reprojection freature if not using EPSG 3857 or 4326
          isCustomTilingScheme(this.model._imageryProvider?.tilingScheme)
        ? i18next.t(
            ($) => $.models.cogCatalogItem.experimentalReprojectionWarning
          )
        : undefined;
  }

  @computed
  get legends(): StratumFromTraits<LegendTraits>[] | undefined {
    const { binEdges, binColors, colors, domain, colorStops } =
      this.model.renderOptions.single ?? {};
    const range = colorStops
      ? [colorStops[0], colorStops[colorStops.length - 1]]
      : domain;
    if (
      colors &&
      range &&
      colors.length >= 2 &&
      colors.every((color) => /^#[0-9a-f]{6}$/i.test(color)) &&
      range.length === 2 &&
      range.every(Number.isFinite) &&
      range[0] < range[1] &&
      (!colorStops ||
        (colorStops.length === colors.length &&
          colorStops.every(
            (value, i) =>
              Number.isFinite(value) && (i === 0 || value > colorStops[i - 1])
          )))
    ) {
      const stops = colors
        .map(
          (color, i) =>
            `<stop offset="${colorStops ? (colorStops[i] - range[0]) / (range[1] - range[0]) : i / (colors.length - 1)}" stop-color="${color}"/>`
        )
        .join("");
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="65" viewBox="0 0 240 65"><defs><linearGradient id="ramp" color-interpolation="sRGB">${stops}</linearGradient></defs><rect width="240" height="65" fill="white"/><rect x="12" y="10" width="216" height="20" fill="url(#ramp)" stroke="#777"/><g font-family="sans-serif" font-size="12" fill="black"><text x="12" y="50">${range[0]}</text><text x="228" y="50" text-anchor="end">${range[1]}</text></g></svg>`;
      return [
        createStratumInstance(LegendTraits, {
          title: `Band ${this.model.renderOptions.single.band ?? 1}`,
          url: `data:image/svg+xml,${encodeURIComponent(svg)}`,
          urlMimeType: "image/svg+xml"
        })
      ];
    }
    if (!binEdges || !binColors || binEdges.length !== binColors.length + 1)
      return undefined;

    return [
      createStratumInstance(LegendTraits, {
        title: `Band ${this.model.renderOptions.single.band ?? 1}`,
        items: binColors.map((color, i) =>
          createStratumInstance(LegendItemTraits, {
            color,
            outlineColor: "#777777",
            outlineWidth: 1,
            title:
              binColors.length === 1
                ? "All valid values"
                : i === 0
                  ? `< ${binEdges[i + 1]}`
                  : i === binColors.length - 1
                    ? `>= ${binEdges[i]}`
                    : `${binEdges[i]} <= value < ${binEdges[i + 1]}`
          })
        )
      })
    ];
  }

  @computed
  get rectangle(): StratumFromTraits<RectangleTraits> | undefined {
    const rectangle = this.model._imageryProvider?.rectangle;
    if (!rectangle) {
      return;
    }

    const { west, south, east, north } = rectangle;
    return {
      west: CesiumMath.toDegrees(west),
      south: CesiumMath.toDegrees(south),
      east: CesiumMath.toDegrees(east),
      north: CesiumMath.toDegrees(north)
    };
  }
}

StratumOrder.addLoadStratum(CogLoadableStratum.stratumName);

/**
 * Creates a Cloud Optimised Geotiff catalog item.
 *
 * Currently it can render EPSG 4326/3857 COG files. There is experimental
 * support for other projections, however it is less performant and could have
 * unknown issues.
 */
export default class CogCatalogItem extends MappableMixin(
  CatalogMemberMixin(CreateModel(CogCatalogItemTraits))
) {
  static readonly type = "cog";

  /**
   * Private imageryProvider instance. This is set once forceLoadMapItems is
   * called.
   */
  @observable
  _imageryProvider: TIFFImageryProvider | undefined;

  /**
   * The reprojector function to use for reprojecting non native projections
   *
   * Exposed here as instance variable for stubbing in specs.
   */
  reprojector = reprojector;

  get type() {
    return CogCatalogItem.type;
  }

  constructor(
    id: string | undefined,
    terria: Terria,
    sourceReference?: BaseModel | undefined
  ) {
    super(id, terria, sourceReference);
    makeObservable(this);
    this.strata.set(
      CogLoadableStratum.stratumName,
      new CogLoadableStratum(this)
    );

    // Destroy the imageryProvider when `mapItems` is no longer consumed. This
    // is so that the webworkers and other resources created by the
    // imageryProvider can be freed. Ideally, there would be a more explicit
    // `destroy()` method in Terria life-cycle so that we don't have to rely on
    // mapItems becoming observed or unobserved.
    onBecomeUnobserved(this, "mapItems", () => {
      if (this._imageryProvider) {
        this._imageryProvider.destroy();
        this._imageryProvider = undefined;
      }
    });

    // Re-create the imageryProvider if `mapItems` is consumed again after we
    // destroyed it
    onBecomeObserved(this, "mapItems", () => {
      if (!this._imageryProvider && !this.isLoadingMapItems) {
        this.loadMapItems(true);
      }
    });
  }

  protected async forceLoadMapItems(): Promise<void> {
    if (!this.url) {
      return;
    }
    const url = proxyCatalogItemUrl(this, this.url);
    const imageryProvider = await this.createImageryProvider(url);
    runInAction(() => {
      this._imageryProvider = imageryProvider;
    });
  }

  @computed get mapItems(): MapItem[] {
    const imageryProvider = this._imageryProvider;
    if (!imageryProvider) {
      return [];
    }

    return [
      {
        show: this.show,
        alpha: this.opacity,
        // The 'requestImage' method in Cesium's ImageryProvider has a return type that is stricter than necessary.
        // In our custom ImageryProvider, we return ImageData, which is also a valid return type.
        // However, since the current Cesium type definitions do not reflect this flexibility, we use a TypeScript ignore comment ('@ts-ignore')
        // to suppress the type checking error. This is a temporary solution until the type definitions in Cesium are updated to accommodate ImageData.
        // @ts-expect-error - The return type of 'requestImage' method in our custom ImageryProvider can be ImageData, which is not currently allowed in Cesium's type definitions, but is fine.
        imageryProvider,
        clippingRectangle: this.cesiumRectangle
      }
    ];
  }

  /**
   * Create TIFFImageryProvider for the given url.
   */
  private async createImageryProvider(
    url: string
  ): Promise<TIFFImageryProvider> {
    const { band, domain, binEdges, binColors, colors, colorStops } =
      this.renderOptions.single ?? {};
    const hasBins = binEdges !== undefined || binColors !== undefined;
    if (
      colorStops !== undefined &&
      (!colors ||
        colorStops.length < 2 ||
        colorStops.length !== colors.length ||
        !colorStops.every(
          (value, i) =>
            Number.isFinite(value) && (i === 0 || value > colorStops[i - 1])
        ) ||
        domain !== undefined ||
        hasBins)
    ) {
      throw new TerriaError({
        sender: this,
        message:
          "COG colorStops require ascending finite values, one per color, without domain or bins."
      });
    }
    if (
      colors !== undefined &&
      (colors.length < 2 ||
        !colors.every((color) => /^#[0-9a-f]{6}$/i.test(color)) ||
        (domain === undefined && colorStops === undefined) ||
        hasBins)
    ) {
      throw new TerriaError({
        sender: this,
        message:
          "COG continuous colors require at least two #RRGGBB colors and either colorStops or domain, without bins."
      });
    }
    if (
      hasBins &&
      (!binEdges ||
        !binColors ||
        binEdges.length < 2 ||
        binColors.length !== binEdges.length - 1 ||
        !binEdges.every(
          (edge, i) =>
            Number.isFinite(edge) && (i === 0 || edge > binEdges[i - 1])
        ) ||
        !binColors.every((color) => /^#[0-9a-f]{6}$/i.test(color)) ||
        domain !== undefined)
    ) {
      throw new TerriaError({
        sender: this,
        message:
          "COG bins require ascending finite binEdges and one #RRGGBB binColor per interval, without domain."
      });
    }
    let single: SingleBandRenderOptions | undefined;
    if (
      band !== undefined ||
      domain !== undefined ||
      hasBins ||
      colors !== undefined
    ) {
      const bandIndex = band ?? 1;
      if (!Number.isInteger(bandIndex) || bandIndex < 1) {
        throw new TerriaError({
          sender: this,
          message: "renderOptions.single.band must be a positive integer."
        });
      }
      if (
        domain !== undefined &&
        (domain.length !== 2 ||
          !domain.every(Number.isFinite) ||
          domain[0] >= domain[1])
      ) {
        throw new TerriaError({
          sender: this,
          message:
            "renderOptions.single.domain must contain two finite values with minimum less than maximum."
        });
      }
      if (this.renderOptions.convertToRGB === true) {
        throw new TerriaError({
          sender: this,
          message:
            "Single-band rendering cannot be combined with convertToRGB: true."
        });
      }
      single = domain
        ? { band: bandIndex, domain: [domain[0], domain[1]] }
        : { band: bandIndex };
      if (binEdges && binColors) {
        single.domain = [binEdges[0], binEdges[binEdges.length - 1]];
        single.type = "discrete";
        single.useRealValue = true;
        single.colors = binColors.map((color, i): [number, string] => [
          binEdges[i],
          color
        ]);
      }
      if (colors) {
        single.type = "continuous";
        single.useRealValue = true;
        if (colorStops) {
          single.domain = [colorStops[0], colorStops[colorStops.length - 1]];
          single.colors = colors.map((color, i): [number, string] => [
            colorStops[i],
            color
          ]);
        } else if (domain) {
          single.colors = colors.map((color, i): [number, string] => {
            const fraction = i / (colors.length - 1);
            return [(1 - fraction) * domain[0] + fraction * domain[1], color];
          });
        }
      }
      if (single.colors) {
        single.clampLow = true;
        single.clampHigh = true;
      }
    }

    // lazy load the imagery provider, only when needed
    const [{ default: TIFFImageryProvider }, { default: proj4 }] =
      await Promise.all([
        import("terriajs-tiff-imagery-provider"),
        import("proj4-fully-loaded")
      ]);

    const provider = await runInAction(() =>
      TIFFImageryProvider.fromUrl(url, {
        credit: this.credit,
        tileSize: this.tileSize,
        maximumLevel: this.maximumLevel,
        minimumLevel: this.minimumLevel,
        enablePickFeatures: this.allowFeaturePicking,
        hasAlphaChannel: this.hasAlphaChannel,
        // used for reprojecting from an unknown projection to 4326/3857
        // note that this is experimental and could be slow as it runs on the main thread
        projFunc: this.reprojector(proj4),
        // make sure we omit `undefined` options so as not to override the library defaults
        renderOptions: omitUndefined({
          single,
          nodata: this.renderOptions.nodata,
          convertToRGB: this.renderOptions.convertToRGB,
          resampleMethod: this.renderOptions.resampleMethod
        })
      })
    );
    if (single?.colors && !provider.plot?.gl) {
      provider.destroy();
      throw new TerriaError({
        sender: this,
        message:
          "Custom COG color styles require WebGL with floating-point textures. Enable browser hardware acceleration or use an unstyled grayscale COG."
      });
    }
    return provider;
  }
}

/**
 * Function returning a custom reprojector
 */
function reprojector(proj4: any) {
  return (code: number) => {
    if (![4326, 3857, 900913].includes(code)) {
      try {
        const prj = proj4("EPSG:4326", `EPSG:${code}`);
        if (prj)
          return {
            project: prj.forward,
            unproject: prj.inverse
          };
      } catch (e) {
        console.error(e);
      }
    }
  };
}

/**
 * Returns true if the tilingScheme is custom
 */
function isCustomTilingScheme(tilingScheme: object) {
  // The upstream library defines a TIFFImageryTillingScheme but it is not
  // exported so we have to check if it is not one of the standard Cesium
  // tiling schemes. Also, because TIFFImageryTillingScheme derives from
  // WebMercatorTilingScheme, we cannot simply do an `instanceof` check, we
  // compare the exact constructor instead.
  return (
    tilingScheme.constructor !== WebMercatorTilingScheme &&
    tilingScheme.constructor !== GeographicTilingScheme
  );
}

function omitUndefined(obj: object) {
  return Object.fromEntries(
    Object.entries(obj).filter(([_, value]) => value !== undefined)
  );
}
