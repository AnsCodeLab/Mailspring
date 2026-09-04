import { computeImagePresetSize } from '../src/components/attachment-items';

describe('computeImagePresetSize', () => {
  describe('a large landscape image (1200x600, 2:1 ratio)', () => {
    const naturalWidth = 1200;
    const naturalHeight = 600;

    it('returns undefined for "original" (clears imgProps, falls back to natural size)', () =>
      expect(computeImagePresetSize('original', naturalWidth, naturalHeight)).toBeUndefined());

    it('scales "large" down to 600 wide, preserving aspect ratio', () =>
      expect(computeImagePresetSize('large', naturalWidth, naturalHeight)).toEqual({
        width: 600,
        height: 300,
      }));

    it('scales "medium" down to 320 wide, preserving aspect ratio', () =>
      expect(computeImagePresetSize('medium', naturalWidth, naturalHeight)).toEqual({
        width: 320,
        height: 160,
      }));

    it('scales "small" down to 160 wide, preserving aspect ratio', () =>
      expect(computeImagePresetSize('small', naturalWidth, naturalHeight)).toEqual({
        width: 160,
        height: 80,
      }));
  });

  describe('an image already smaller than every preset (100x50)', () => {
    const naturalWidth = 100;
    const naturalHeight = 50;

    it('never upscales "large" beyond the natural size', () =>
      expect(computeImagePresetSize('large', naturalWidth, naturalHeight)).toEqual({
        width: 100,
        height: 50,
      }));

    it('never upscales "medium" beyond the natural size', () =>
      expect(computeImagePresetSize('medium', naturalWidth, naturalHeight)).toEqual({
        width: 100,
        height: 50,
      }));

    it('never upscales "small" beyond the natural size', () =>
      expect(computeImagePresetSize('small', naturalWidth, naturalHeight)).toEqual({
        width: 100,
        height: 50,
      }));
  });

  describe('a portrait image (900x1800, 1:2 ratio) confirms height-side aspect-ratio math', () => {
    const naturalWidth = 900;
    const naturalHeight = 1800;

    it('scales "large" to 600 wide / 1200 tall', () =>
      expect(computeImagePresetSize('large', naturalWidth, naturalHeight)).toEqual({
        width: 600,
        height: 1200,
      }));

    it('scales "medium" to 320 wide / 640 tall', () =>
      expect(computeImagePresetSize('medium', naturalWidth, naturalHeight)).toEqual({
        width: 320,
        height: 640,
      }));

    it('scales "small" to 160 wide / 320 tall', () =>
      expect(computeImagePresetSize('small', naturalWidth, naturalHeight)).toEqual({
        width: 160,
        height: 320,
      }));
  });
});
