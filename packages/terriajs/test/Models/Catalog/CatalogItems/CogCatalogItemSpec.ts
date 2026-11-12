import { reaction, when } from "mobx";
import { http, passthrough } from "msw";
import { TIFFImageryProvider } from "terriajs-tiff-imagery-provider";
import Rectangle from "terriajs-cesium/Source/Core/Rectangle";
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

function readPlotPixels(provider: TIFFImageryProvider): Uint8ClampedArray {
  const plot = provider.plot!;
  const canvas = document.createElement("canvas");
  canvas.width = plot.canvas.width;
  canvas.height = plot.canvas.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(plot.canvas, 0, 0);
  expect(plot.gl).toBeTruthy();
  return context.getImageData(0, 0, canvas.width, canvas.height).data;
}

function expectPixelsClose(
  actual: Uint8ClampedArray,
  expected: number[]
): void {
  expect(actual.length).toBe(expected.length);
  actual.forEach((value, i) => {
    // Native palettes quantize RGB through a lookup texture; alpha is exact.
    expect(Math.abs(value - expected[i]))
      .withContext(`pixel channel ${i}`)
      .toBeLessThanOrEqual(i % 4 === 3 ? 0 : 2);
  });
}

function requireFloatWebGL(): void {
  const gl = document.createElement("canvas").getContext("webgl");
  const supported = !!gl?.getExtension("OES_texture_float");
  gl?.getExtension("WEBGL_lose_context")?.loseContext();
  if (!supported)
    pending("Native COG color rendering requires float-texture WebGL.");
}

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
      [
        {},
        { colorStops: [-70, 50], colors: ["#0000ff", "#ff0000"] },
        { binEdges: [-70, 0, 50], binColors: ["#0000ff", "#ff0000"] }
      ].forEach((style) => {
        it(`masks NaN before native texture upload for ${JSON.stringify(style)}`, async function () {
          requireFloatWebGL();
          updateModelFromJson(item, CommonStrata.user, {
            url: TEST_URLS["4326"],
            renderOptions: {
              nodata: -9999,
              single: { band: 1, ...style }
            }
          }).throwIfError();
          (await item.loadMapItems()).throwIfError();
          const provider = getImageryProvider(item);
          const plot = provider.plot!;
          plot.removeAllDataset();
          const samples = new Float64Array([NaN, -9999, -35, 25]);
          plot.addDataset("b1", samples, 4, 1);
          expect(plot.datasetCollection.b1.data[0]).toBe(-Infinity);
          expect(Number.isNaN(samples[0])).toBe(true);
          expect(samples[1]).toBe(-9999);
          plot.renderDataset("b1");
          const pixels = readPlotPixels(provider);
          expect(pixels[3]).toBe(0);
          expect(pixels[7]).toBe(0);
          expect(pixels[11]).toBe(255);
          expect(pixels[15]).toBe(255);
          expect(plot.datasetCollection.b1.data[2]).toBe(-35);
          const validSamples = new Float64Array([-35, 25]);
          plot.removeAllDataset();
          plot.addDataset("b1", validSamples, 2, 1);
          expect(plot.datasetCollection.b1.data).toBe(validSamples);
          provider.destroy();
        });
      });

      it("reports unavailable WebGL and destroys the unsupported provider", async function () {
        updateModelFromJson(item, CommonStrata.user, {
          url: TEST_URLS["4326"],
          renderOptions: {
            single: { colorStops: [0, 1], colors: ["#000000", "#ffffff"] }
          }
        }).throwIfError();
        const fromUrl = TIFFImageryProvider.fromUrl;
        let destroy: jasmine.Spy | undefined;
        spyOn(TIFFImageryProvider, "fromUrl").and.callFake(
          async (url, options) => {
            const provider = await fromUrl(url, options);
            const plot = provider.plot!;
            const gl = plot.gl;
            plot.gl = null;
            const destroyProvider = provider.destroy.bind(provider);
            destroy = spyOn(provider, "destroy").and.callFake(() => {
              plot.gl = gl;
              destroyProvider();
            });
            return provider;
          }
        );
        const result = await item.loadMapItems();
        expect(result.error).toBeDefined();
        expect(
          result.error
            ?.flatten()
            .some((error) => error.message.includes("WebGL"))
        ).toBe(true);
        expect(destroy).toHaveBeenCalledTimes(1);
        expect(item.mapItems).toEqual([]);
      });

      it("uses uneven color stops for raster interpolation and legend offsets", async function () {
        requireFloatWebGL();
        updateModelFromJson(item, CommonStrata.user, {
          url: TEST_URLS["4326"],
          renderOptions: {
            nodata: -9999,
            single: {
              colorStops: [-70, 0, 50],
              colors: ["#0000ff", "#ffffff", "#ff0000"]
            }
          }
        }).throwIfError();
        (await item.loadMapItems()).throwIfError();
        const provider = getImageryProvider(item);
        expect(provider.renderOptions.single?.domain).toEqual([-70, 50]);
        expect(provider.renderOptions.single).toEqual(
          jasmine.objectContaining({
            type: "continuous",
            useRealValue: true,
            colors: [
              [-70, "#0000ff"],
              [0, "#ffffff"],
              [50, "#ff0000"]
            ],
            clampLow: true,
            clampHigh: true
          })
        );
        const plot = provider.plot!;
        plot.removeAllDataset();
        plot.addDataset(
          "b1",
          new Float64Array([-80, -70, -35, 0, 25, 50, 60]),
          7,
          1
        );
        plot.renderDataset("b1");
        expectPixelsClose(
          readPlotPixels(provider),
          [
            0, 0, 255, 255, 0, 0, 255, 255, 128, 128, 255, 255, 255, 255, 255,
            255, 255, 128, 128, 255, 255, 0, 0, 255, 255, 0, 0, 255
          ]
        );
        const svg = decodeURIComponent(item.legends[0].url!.split(",")[1]);
        const legend = new DOMParser().parseFromString(svg, "image/svg+xml");
        expect(
          Array.from(legend.querySelectorAll("stop")).map((stop) =>
            Number(stop.getAttribute("offset"))
          )
        ).toEqual([0, 70 / 120, 1]);
        expect(
          Array.from(legend.querySelectorAll("text")).map(
            (text) => text.textContent
          )
        ).toEqual(["-70", "50"]);
        provider.destroy();
      });

      [
        { colorStops: [-70, 50] },
        { colorStops: [], colors: ["#000000", "#ffffff"] },
        { colorStops: [0, 0], colors: ["#000000", "#ffffff"] },
        { colorStops: [1, 0], colors: ["#000000", "#ffffff"] },
        { colorStops: [0, Infinity], colors: ["#000000", "#ffffff"] },
        { colorStops: [NaN, 1], colors: ["#000000", "#ffffff"] },
        { colorStops: [0, 1, 2], colors: ["#000000", "#ffffff"] },
        { colorStops: [0, 1], colors: ["#000000", "#ffffff"], domain: [0, 1] },
        {
          colorStops: [0, 1],
          colors: ["#000000", "#ffffff"],
          binEdges: [0, 1],
          binColors: ["#000000"]
        }
      ].forEach((single) => {
        it(`rejects invalid colorStops ${JSON.stringify(single)}`, async function () {
          updateModelFromJson(item, CommonStrata.user, {
            url: TEST_URLS["4326"],
            renderOptions: { single }
          }).throwIfError();
          const fromUrl = spyOn(
            TIFFImageryProvider,
            "fromUrl"
          ).and.callThrough();
          expect((await item.loadMapItems()).error).toBeDefined();
          expect(fromUrl).not.toHaveBeenCalled();
        });
      });

      it("renders a continuous ramp through tile requests and generates a gradient legend", async function () {
        requireFloatWebGL();
        updateModelFromJson(item, CommonStrata.user, {
          url: TEST_URLS["4326"],
          renderOptions: {
            nodata: -9999,
            single: {
              domain: [-70, 50],
              colors: ["#0000ff", "#ffffff", "#ff0000"]
            }
          }
        }).throwIfError();
        (await item.loadMapItems()).throwIfError();
        const provider = getImageryProvider(item);
        const plot = provider.plot!;
        expect(provider.renderOptions.single).toEqual(
          jasmine.objectContaining({
            type: "continuous",
            useRealValue: true,
            colors: [
              [-70, "#0000ff"],
              [-10, "#ffffff"],
              [50, "#ff0000"]
            ]
          })
        );
        plot.removeAllDataset();
        plot.addDataset(
          "b1",
          new Float64Array([-9999, NaN, -70, -40, -10, 20, 50]),
          7,
          1
        );
        plot.renderDataset("b1");
        expectPixelsClose(
          readPlotPixels(provider),
          [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 255, 128, 128, 255, 255, 255,
            255, 255, 255, 255, 128, 128, 255, 255, 0, 0, 255
          ]
        );
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
        let opaqueCount = 0;
        for (let i = 0; i < pixels.length; i += 4) {
          if (pixels[i + 3] !== 0) {
            opaqueCount++;
            expect(pixels[i + 3]).toBe(255);
            expect(pixels[i + 2]).toBeGreaterThan(0);
          }
        }
        expect(opaqueCount).toBeGreaterThan(0);
        const legend = item.legends[0];
        expect(legend.urlMimeType).toBe("image/svg+xml");
        const svg = decodeURIComponent(legend.url!.split(",")[1]);
        const legendDocument = new DOMParser().parseFromString(
          svg,
          "image/svg+xml"
        );
        expect(legendDocument.querySelector("parsererror")).toBeNull();
        expect(
          Array.from(legendDocument.querySelectorAll("stop")).map((stop) =>
            stop.getAttribute("stop-color")
          )
        ).toEqual(["#0000ff", "#ffffff", "#ff0000"]);
        expect(
          Array.from(legendDocument.querySelectorAll("text")).map(
            (text) => text.textContent
          )
        ).toEqual(["-70", "50"]);
        const legendImage = new Image();
        await new Promise<void>((resolve, reject) => {
          legendImage.onload = () => resolve();
          legendImage.onerror = () =>
            reject(new Error("Continuous legend image failed to load"));
          legendImage.src = legend.url!;
        });
        expect(legendImage.naturalWidth).toBe(240);
        updateModelFromJson(item, CommonStrata.user, {
          legends: [
            { title: "Custom continuous legend", items: [{ color: "#0000ff" }] }
          ]
        }).throwIfError();
        expect(item.legends[0].title).toBe("Custom continuous legend");
        provider.destroy();
      });

      [
        { colors: [], domain: [0, 1] },
        { colors: ["#0000ff"], domain: [0, 1] },
        { colors: ["#0000ff", "#ffffff"] },
        { colors: ["blue", "white"], domain: [0, 1] },
        { colors: ["#0000ff", "#ffffff"], domain: [0, 0] },
        { colors: ["#0000ff", "#ffffff"], domain: [NaN, 1] },
        { colors: ["#0000ff", "#ffffff"], domain: [0, Infinity] },
        {
          colors: ["#0000ff", "#ffffff"],
          domain: [0, 1],
          binEdges: [0, 1],
          binColors: ["#000000"]
        }
      ].forEach((single) => {
        it(`rejects invalid continuous options ${JSON.stringify(single)}`, async function () {
          updateModelFromJson(item, CommonStrata.user, {
            url: TEST_URLS["4326"],
            renderOptions: { single }
          }).throwIfError();
          const fromUrl = spyOn(
            TIFFImageryProvider,
            "fromUrl"
          ).and.callThrough();
          expect((await item.loadMapItems()).error).toBeDefined();
          expect(fromUrl).not.toHaveBeenCalled();
        });
      });

      it("renders blue bins through the provider tile renderer", async function () {
        requireFloatWebGL();
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
        expect(provider.renderOptions.single).toEqual(
          jasmine.objectContaining({
            type: "discrete",
            useRealValue: true,
            domain: [-70, 50],
            colors: [
              [-70, colors[0]],
              [-40, colors[1]],
              [-10, colors[2]],
              [20, colors[3]]
            ],
            clampLow: true,
            clampHigh: true
          })
        );
        expectPixelsClose(
          readPlotPixels(provider),
          [
            0, 0, 0, 0, 0, 0, 0, 0, 239, 243, 255, 255, 189, 215, 231, 255, 107,
            174, 214, 255, 33, 113, 181, 255, 33, 113, 181, 255
          ]
        );
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

      it("renders native grayscale bins and generates a clamped legend", async function () {
        requireFloatWebGL();
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
        expect(provider.renderOptions.single?.type).toBe("discrete");
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
          new Float64Array([-9999, NaN, -80, -70, -50, -40, -10, 20, 50, 60]),
          10,
          1
        );
        plot.renderDataset("b1");
        expectPixelsClose(
          readPlotPixels(provider),
          [
            0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255,
            85, 85, 85, 255, 170, 170, 170, 255, 255, 255, 255, 255, 255, 255,
            255, 255, 255, 255, 255, 255
          ]
        );
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
