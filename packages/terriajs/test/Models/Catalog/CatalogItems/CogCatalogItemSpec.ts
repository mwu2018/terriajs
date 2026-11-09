import { reaction, when } from "mobx";
import { http, passthrough } from "msw";
import { TIFFImageryProvider } from "terriajs-tiff-imagery-provider";
import Rectangle from "terriajs-cesium/Source/Core/Rectangle";
import { renderCogGrayscaleBins } from "../../../../lib/Map/ImageryProvider/CogGrayscaleBins";
import { ImageryParts } from "../../../../lib/ModelMixins/MappableMixin";
import CogCatalogItem from "../../../../lib/Models/Catalog/CatalogItems/CogCatalogItem";
import CommonStrata from "../../../../lib/Models/Definition/CommonStrata";
import updateModelFromJson from "../../../../lib/Models/Definition/updateModelFromJson";
import Terria from "../../../../lib/Models/Terria";
import { worker } from "../../../mocks/browser";

const TEST_URLS = {
  "4326": "/test/cogs/4326.tif", // a 1x1 tif in native EPSG:4326 projection
  "32756": "/test/cogs/32756.tif" // a 1x1 tif in non-native 32756 projection
};

describe("CogCatalogItem", function () {
  let item: CogCatalogItem;

  beforeEach(function () {
    item = new CogCatalogItem("test", new Terria());

    worker.use(
      http.get(TEST_URLS["4326"], () => passthrough()),
      http.get(TEST_URLS["32756"], () => passthrough())
    );
  });

  it("should have a type 'cog'", function () {
    expect(item.type).toEqual("cog");
  });

  it("can be instantiated", function () {
    expect(item).toBeDefined();
  });

  describe("mapItems", function () {
    // Test for each valid URL
    it(`should return a TIFFImageryProvider`, async function () {
      const testUrl = TEST_URLS["4326"];
      item.setTrait(CommonStrata.user, "url", testUrl);
      await item.loadMapItems();
      const mapItem = item.mapItems[0];
      expect(mapItem).toBeDefined();
      expect(ImageryParts.is(mapItem)).toBe(true);
      if (ImageryParts.is(mapItem)) {
        expect(mapItem.imageryProvider instanceof TIFFImageryProvider).toBe(
          true
        );
      }
    });
  });

  describe("TIFFImageryProvider initialization", function () {
    it("uses the correct url", async function () {
      const testUrl = TEST_URLS["4326"];
      item.setTrait(CommonStrata.user, "url", testUrl);

      const fromUrl = spyOn(TIFFImageryProvider, "fromUrl").and.callThrough();
      await item.loadMapItems();
      expect(item.mapItems[0]).toBeDefined();

      const [url] = fromUrl.calls.first().args;
      expect(url).toBe(testUrl);
    });

    it("correctly initializes the basic TIFFImageryProvider options", async function () {
      const testUrl = TEST_URLS["4326"];
      item.setTrait(CommonStrata.user, "url", testUrl);
      item.setTrait(CommonStrata.user, "credit", "Y");
      item.setTrait(CommonStrata.user, "tileSize", 1);
      item.setTrait(CommonStrata.user, "minimumLevel", 5);
      item.setTrait(CommonStrata.user, "maximumLevel", 10);
      item.setTrait(CommonStrata.user, "hasAlphaChannel", false);
      await item.loadMapItems();

      const imageryProvider = getImageryProvider(item);
      expect(imageryProvider).toBeDefined();
      expect(imageryProvider.credit.html).toBe("Y");
      expect(imageryProvider.tileSize).toBe(1);
      expect(imageryProvider.minimumLevel).toBe(5);
      expect(imageryProvider.maximumLevel).toBe(10);
      expect(imageryProvider.hasAlphaChannel).toBe(false);
    });

    describe("renderOptions", function () {
      it("renders blue bins through the provider tile renderer", async function () {
        const colors = ["#eff3ff", "#bdd7e7", "#6baed6", "#2171b5"];
        updateModelFromJson(item, CommonStrata.user, {
          url: TEST_URLS["4326"],
          renderOptions: {
            nodata: -9999,
            single: {
              binEdges: [-70, -40, -10, 20, 50],
              binColors: colors
            }
          }
        }).throwIfError();
        (await item.loadMapItems()).throwIfError();
        const provider = getImageryProvider(item);
        const plot = provider.plot!;
        plot.removeAllDataset();
        plot.addDataset(
          "b1",
          new Float64Array([-9999, NaN, -80, -40, -10, 20, 60]),
          7,
          1
        );
        plot.renderDataset("b1");
        expect(Array.from(plot.ctx.getImageData(0, 0, 7, 1).data)).toEqual([
          0, 0, 0, 0, 0, 0, 0, 0, 239, 243, 255, 255, 189, 215, 231, 255, 107,
          174, 214, 255, 33, 113, 181, 255, 33, 113, 181, 255
        ]);
        const center = Rectangle.center(provider.rectangle);
        const tile = provider.tilingScheme.positionToTileXY(
          center,
          provider.minimumLevel
        )!;
        const image = await provider.requestImage(
          tile.x,
          tile.y,
          provider.minimumLevel
        );
        const canvas = document.createElement("canvas");
        canvas.width = provider.tileWidth;
        canvas.height = provider.tileHeight;
        const context = canvas.getContext("2d")!;
        if (image instanceof ImageData) context.putImageData(image, 0, 0);
        else context.drawImage(image, 0, 0);
        const pixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;
        const rendered = new Set<string>();
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] !== 0) {
            expect(pixels[i + 3]).toBe(255);
            rendered.add(
              `#${Array.from(pixels.slice(i, i + 3))
                .map((channel) => channel.toString(16).padStart(2, "0"))
                .join("")}`
            );
          }
        }
        expect(rendered.size).toBeGreaterThan(0);
        rendered.forEach((color) => expect(colors).toContain(color));
        expect(item.legends[0].items.map((entry) => entry.color)).toEqual(
          colors
        );
        provider.destroy();
      });

      it("renders exact grayscale bins and generates a clamped legend", async function () {
        updateModelFromJson(item, CommonStrata.user, {
          url: TEST_URLS["4326"],
          renderOptions: {
            nodata: -9999,
            single: {
              binEdges: [-70, -40, -10, 20, 50],
              binColors: ["#000000", "#555555", "#aaaaaa", "#ffffff"]
            }
          }
        }).throwIfError();
        (await item.loadMapItems()).throwIfError();
        const provider = getImageryProvider(item);
        const plot = provider.plot!;
        expect(plot.gl).toBeFalsy();
        const center = Rectangle.center(provider.rectangle);
        const tile = provider.tilingScheme.positionToTileXY(
          center,
          provider.minimumLevel
        )!;
        const image = await provider.requestImage(
          tile.x,
          tile.y,
          provider.minimumLevel
        );
        expect(image).toBeDefined();
        const canvas = document.createElement("canvas");
        canvas.width = provider.tileWidth;
        canvas.height = provider.tileHeight;
        const context = canvas.getContext("2d")!;
        if (image instanceof ImageData) context.putImageData(image, 0, 0);
        else context.drawImage(image, 0, 0);
        const tilePixels = context.getImageData(
          0,
          0,
          canvas.width,
          canvas.height
        ).data;
        const opaqueColors = new Set<number>();
        for (let i = 0; i < tilePixels.length; i += 4) {
          if (tilePixels[i + 3] !== 0) {
            expect(tilePixels[i + 3]).toBe(255);
            expect(tilePixels[i]).toBe(tilePixels[i + 1]);
            expect(tilePixels[i]).toBe(tilePixels[i + 2]);
            opaqueColors.add(tilePixels[i]);
          }
        }
        expect(opaqueColors.size).toBeGreaterThan(0);
        opaqueColors.forEach((color) =>
          expect([0, 85, 170, 255]).toContain(color)
        );
        plot.removeAllDataset();
        plot.addDataset(
          "b1",
          new Float64Array([
            -9999,
            NaN,
            -80,
            -70,
            -40.001,
            -40,
            -10,
            20,
            50,
            60
          ]),
          10,
          1
        );
        plot.renderDataset("b1");
        const pixels = plot.ctx.getImageData(0, 0, 10, 1).data;
        expect(Array.from(pixels)).toEqual([
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255, 85,
          85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255, 255, 255, 255,
          255, 255, 255, 255, 255
        ]);
        expect(item.legends[0].items.map((entry) => entry.title)).toEqual([
          "< -40",
          "-40 <= value < -10",
          "-10 <= value < 20",
          ">= 20"
        ]);
        provider.destroy();
      });

      it("lets a configured legend override the generated bin legend", function () {
        updateModelFromJson(item, CommonStrata.user, {
          renderOptions: {
            single: {
              binEdges: [0, 1],
              binColors: ["#555555"]
            }
          },
          legends: [
            { title: "Custom", items: [{ color: "#555555", title: "Values" }] }
          ]
        }).throwIfError();
        expect(item.legends[0].title).toBe("Custom");
      });

      it("masks nonfinite values and preserves source samples", function () {
        const data = new Float64Array([NaN, Infinity, -Infinity, -9999, 0, 1]);
        const result = renderCogGrayscaleBins(data, [0, 1], [0x808080], -9999);
        expect(Array.from(result.slice(0, 16))).toEqual(new Array(16).fill(0));
        expect(Array.from(result.slice(16))).toEqual([
          128, 128, 128, 255, 128, 128, 128, 255
        ]);
        expect(Number.isNaN(data[0])).toBe(true);
        expect(data[3]).toBe(-9999);
        expect(data[5]).toBe(1);
      });

      [
        { binEdges: [0, 1] },
        { binColors: ["#000000"] },
        { binEdges: [0], binColors: [] },
        { binEdges: [0, 0], binColors: ["#000000"] },
        { binEdges: [1, 0], binColors: ["#000000"] },
        { binEdges: [0, Infinity], binColors: ["#000000"] },
        { binEdges: [NaN, 1], binColors: ["#000000"] },
        { binEdges: [0, 1], binColors: ["#000000", "#ffffff"] },
        { binEdges: [0, 1], binColors: ["#00000000"] },
        { binEdges: [0, 1], binColors: ["invalid"] },
        { binEdges: [0, 1], binColors: ["#000000"], domain: [0, 1] }
      ].forEach((single) => {
        it(`rejects invalid bin options ${JSON.stringify(single)}`, async function () {
          updateModelFromJson(item, CommonStrata.user, {
            url: TEST_URLS["4326"],
            renderOptions: { single }
          }).throwIfError();
          const fromUrl = spyOn(
            TIFFImageryProvider,
            "fromUrl"
          ).and.callThrough();
          const result = await item.loadMapItems();
          expect(result.error).toBeDefined();
          expect(fromUrl).not.toHaveBeenCalled();
        });
      });

      it("passes the configured single-band stretch to the provider", async function () {
        updateModelFromJson(item, CommonStrata.user, {
          url: TEST_URLS["4326"],
          renderOptions: { single: { band: 1, domain: [-70, 50] } }
        }).throwIfError();
        (await item.loadMapItems()).throwIfError();
        expect(getImageryProvider(item).renderOptions.single).toEqual(
          jasmine.objectContaining({ band: 1, domain: [-70, 50] })
        );
      });

      it("defaults to band 1 when only a domain is configured", async function () {
        updateModelFromJson(item, CommonStrata.user, {
          url: TEST_URLS["4326"],
          renderOptions: { single: { domain: [-70, 50] } }
        }).throwIfError();
        (await item.loadMapItems()).throwIfError();
        expect(getImageryProvider(item).renderOptions.single?.band).toBe(1);
      });

      it("does not force single-band mode when it is not configured", async function () {
        item.setTrait(CommonStrata.user, "url", TEST_URLS["4326"]);
        const fromUrl = spyOn(TIFFImageryProvider, "fromUrl").and.callThrough();
        (await item.loadMapItems()).throwIfError();
        expect(fromUrl.calls.first().args[1]?.renderOptions).not.toEqual(
          jasmine.objectContaining({ single: jasmine.anything() })
        );
      });

      [
        { band: 0 },
        { band: 1.5 },
        { domain: [] },
        { domain: [-70] },
        { domain: [-70, 0, 50] },
        { domain: [50, -70] },
        { domain: [0, 0] },
        { domain: [NaN, 50] },
        { domain: [-70, Infinity] }
      ].forEach((single) => {
        it(`rejects invalid single-band options ${JSON.stringify(single)}`, async function () {
          updateModelFromJson(item, CommonStrata.user, {
            url: TEST_URLS["4326"],
            renderOptions: { single }
          }).throwIfError();
          const fromUrl = spyOn(
            TIFFImageryProvider,
            "fromUrl"
          ).and.callThrough();
          const result = await item.loadMapItems();
          expect(result.error).toBeDefined();
          expect(fromUrl).not.toHaveBeenCalled();
        });
      });

      it("rejects single-band options combined with RGB conversion", async function () {
        updateModelFromJson(item, CommonStrata.user, {
          url: TEST_URLS["4326"],
          renderOptions: {
            convertToRGB: true,
            single: { domain: [-70, 50] }
          }
        }).throwIfError();
        const result = await item.loadMapItems();
        expect(result.error).toBeDefined();
      });

      it("is set correctly", async function () {
        const testUrl = TEST_URLS["4326"];
        item.setTrait(CommonStrata.user, "url", testUrl);
        updateModelFromJson(item.renderOptions, CommonStrata.user, {
          nodata: 42,
          convertToRGB: true,
          resampleMethod: "bilinear"
        });
        await item.loadMapItems();
        const renderOptions = getImageryProvider(item)?.renderOptions;
        expect(renderOptions).toBeDefined();

        expect(renderOptions.nodata).toBe(42);
        expect(renderOptions.convertToRGB).toBe(true);
        expect(renderOptions.resampleMethod).toBe("bilinear");
      });

      it("uses a default value of `bilinear` for `resampleMethod'", async function () {
        const testUrl = TEST_URLS["4326"];
        item.setTrait(CommonStrata.user, "url", testUrl);
        updateModelFromJson(item.renderOptions, CommonStrata.user, {});
        await item.loadMapItems();
        const renderOptions = getImageryProvider(item)?.renderOptions;
        expect(renderOptions).toBeDefined();
        expect(renderOptions.resampleMethod).toBe("nearest");
      });
    });
  });

  describe("reprojection", function () {
    it("reprojects non native projections", async function () {
      const testUrl = TEST_URLS["32756"];
      item.setTrait(CommonStrata.user, "url", testUrl);

      const mockReprojector = jasmine.createSpy();
      item.reprojector = () => mockReprojector;
      await item.loadMapItems();

      expect(mockReprojector.calls.count()).toBe(1);
      expect(mockReprojector.calls.first().args[0]).toBe(32756);
    });
  });

  describe("imageryProvider destruction", function () {
    it("destroys the imageryProvider when `mapItems` is no longer observed", async function () {
      const testUrl = TEST_URLS["4326"];
      item.setTrait(CommonStrata.user, "url", testUrl);
      const destroyReaction = reaction(
        () => item.mapItems,
        () => {},
        { fireImmediately: true }
      );
      await when(() => item.mapItems.length > 0);
      const imageryProvider = getImageryProvider(item);
      expect(imageryProvider).toBeDefined();
      const destroy = spyOn(imageryProvider, "destroy");

      destroyReaction();
      expect(destroy).toHaveBeenCalledTimes(1);
    });

    it("once destroyed, it re-creates imageryProvider if `mapItems` is observed again", async function () {
      const testUrl = TEST_URLS["4326"];
      item.setTrait(CommonStrata.user, "url", testUrl);
      const destroyReaction1 = reaction(
        () => item.mapItems,
        () => {},
        { fireImmediately: true }
      );
      await when(() => item.mapItems.length > 0);
      const imageryProvider1 = getImageryProvider(item);
      expect(imageryProvider1).toBeDefined();
      destroyReaction1();
      expect(item.mapItems.length).toBe(0);

      const destroyReaction2 = reaction(
        () => item.mapItems,
        () => {},
        { fireImmediately: true }
      );
      await when(() => item.mapItems.length > 0);
      const imageryProvider2 = getImageryProvider(item);
      expect(imageryProvider2).toBeDefined();
      destroyReaction2();
    });
  });
});

/**
 * Utility function to get the imagery provider from a CogCatalogItem.
 *
 * @param item The CogCatalogItem to get the imagery provider from.
 * @returns The TIFFImageryProvider if found, otherwise throws an error.
 */
function getImageryProvider(item: CogCatalogItem): TIFFImageryProvider {
  const mapItem = item.mapItems[0];
  if (
    ImageryParts.is(mapItem) &&
    mapItem.imageryProvider instanceof TIFFImageryProvider
  ) {
    return mapItem.imageryProvider;
  } else {
    throw new Error("Load failed");
  }
}
