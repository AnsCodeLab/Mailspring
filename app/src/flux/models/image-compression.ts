export type ImageCompressionLevel = 'high' | 'medium' | 'low';

interface ImageCompressionSetting {
  // Longest edge (px) an image is downscaled to before re-encoding. Images already
  // smaller than this are never upscaled.
  maxDimension: number;
  // JPEG quality (0-100) used when re-encoding. Every level re-encodes as JPEG
  // (even PNG/BMP/WEBP sources) since that's what actually shrinks file size for
  // photographic content; lossless formats gain little from just "recompressing".
  jpegQuality: number;
}

export const IMAGE_COMPRESSION_SETTINGS: {
  [level in ImageCompressionLevel]: ImageCompressionSetting;
} = {
  high: { maxDimension: 2048, jpegQuality: 85 },
  medium: { maxDimension: 1600, jpegQuality: 72 },
  low: { maxDimension: 1024, jpegQuality: 55 },
};

// Pure size-computation logic, kept free of Electron/DOM so it's directly unit-testable.
// Never upscales; returns the original dimensions unchanged when already within budget
// (or when dimensions are unknown/zero).
export function computeCompressedImageDimensions(
  level: ImageCompressionLevel,
  naturalWidth: number,
  naturalHeight: number
): { width: number; height: number } {
  const { maxDimension } = IMAGE_COMPRESSION_SETTINGS[level];
  const largestSide = Math.max(naturalWidth, naturalHeight);

  if (largestSide <= 0 || largestSide <= maxDimension) {
    return { width: naturalWidth, height: naturalHeight };
  }

  const scale = maxDimension / largestSide;
  return {
    width: Math.max(1, Math.round(naturalWidth * scale)),
    height: Math.max(1, Math.round(naturalHeight * scale)),
  };
}
