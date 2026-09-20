import {
  computeCompressedImageDimensions,
  IMAGE_COMPRESSION_SETTINGS,
} from '../src/flux/models/image-compression';

describe('computeCompressedImageDimensions', () => {
  describe('a large landscape photo (4000x2000, 2:1 ratio)', () => {
    const naturalWidth = 4000;
    const naturalHeight = 2000;

    it('downscales "high" to a 2048 longest edge, preserving aspect ratio', () =>
      expect(computeCompressedImageDimensions('high', naturalWidth, naturalHeight)).toEqual({
        width: 2048,
        height: 1024,
      }));

    it('downscales "medium" to a 1600 longest edge, preserving aspect ratio', () =>
      expect(computeCompressedImageDimensions('medium', naturalWidth, naturalHeight)).toEqual({
        width: 1600,
        height: 800,
      }));

    it('downscales "low" to a 1024 longest edge, preserving aspect ratio', () =>
      expect(computeCompressedImageDimensions('low', naturalWidth, naturalHeight)).toEqual({
        width: 1024,
        height: 512,
      }));
  });

  describe('a portrait photo (1200x2400, 1:2 ratio)', () => {
    it('scales off the taller side for "medium" (1600 tall / 800 wide)', () =>
      expect(computeCompressedImageDimensions('medium', 1200, 2400)).toEqual({
        width: 800,
        height: 1600,
      }));
  });

  describe('an image already smaller than every level (800x600)', () => {
    const naturalWidth = 800;
    const naturalHeight = 600;

    it('never upscales "high"', () =>
      expect(computeCompressedImageDimensions('high', naturalWidth, naturalHeight)).toEqual({
        width: naturalWidth,
        height: naturalHeight,
      }));

    it('never upscales "low"', () =>
      expect(computeCompressedImageDimensions('low', naturalWidth, naturalHeight)).toEqual({
        width: naturalWidth,
        height: naturalHeight,
      }));
  });

  it('returns the input unchanged when dimensions are unknown (0x0)', () =>
    expect(computeCompressedImageDimensions('medium', 0, 0)).toEqual({ width: 0, height: 0 }));

  it('orders quality/dimension budgets from "high" (largest, best quality) to "low" (smallest, most compressed)', () => {
    expect(IMAGE_COMPRESSION_SETTINGS.high.maxDimension).toBeGreaterThan(
      IMAGE_COMPRESSION_SETTINGS.medium.maxDimension
    );
    expect(IMAGE_COMPRESSION_SETTINGS.medium.maxDimension).toBeGreaterThan(
      IMAGE_COMPRESSION_SETTINGS.low.maxDimension
    );
    expect(IMAGE_COMPRESSION_SETTINGS.high.jpegQuality).toBeGreaterThan(
      IMAGE_COMPRESSION_SETTINGS.medium.jpegQuality
    );
    expect(IMAGE_COMPRESSION_SETTINGS.medium.jpegQuality).toBeGreaterThan(
      IMAGE_COMPRESSION_SETTINGS.low.jpegQuality
    );
  });
});
