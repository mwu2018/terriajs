import type TIFFImageryProvider from "terriajs-tiff-imagery-provider";

/** Classify unscaled samples, not the provider's quantized output. */
export function renderCogGrayscaleBins(
  data: ArrayLike<number>,
  edges: readonly number[],
  colors: readonly number[],
  noData: number
): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(data.length * 4);
  for (let i = 0; i < data.length; i++) {
    const value = data[i];
    if (!Number.isFinite(value) || value === noData) continue;

    let low = 0;
    let high = colors.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high + 1) / 2);
      if (value >= edges[middle]) low = middle;
      else high = middle - 1;
    }
    const color = colors[low];
    rgba[i * 4] = (color >> 16) & 255;
    rgba[i * 4 + 1] = (color >> 8) & 255;
    rgba[i * 4 + 2] = color & 255;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export default function installCogGrayscaleBins(
  provider: TIFFImageryProvider,
  edges: readonly number[],
  colors: readonly number[]
): void {
  const plot = provider.plot;
  if (!plot || plot.gl || !plot.ctx) {
    throw new Error("COG bin rendering requires the provider's 2D plot.");
  }

  // Keep the provider's loading, resampling, tile cache, and picking; replace
  // only its public plot renderer to avoid color-texture interpolation.
  plot.render = () => {
    const { width, height, data } = plot.currentDataset;
    plot.canvas.width = width;
    plot.canvas.height = height;
    const image = plot.ctx.createImageData(width, height);
    image.data.set(
      renderCogGrayscaleBins(data, edges, colors, provider.noData)
    );
    plot.ctx.putImageData(image, 0, 0);
  };
}
