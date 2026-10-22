import { HttpStatus } from '@nestjs/common';
import sharp from 'sharp';
import { fail } from '../identity/http';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const MAX_PHOTO_PIXELS = 25_000_000;
let activeDecoders = 0;

export async function decodeImage(dataBase64: string, contentType: string): Promise<Buffer> {
  if (
    dataBase64.length > 4 * Math.ceil(MAX_PHOTO_BYTES / 3) ||
    dataBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)
  ) {
    throw invalidPhoto();
  }
  const bytes = Buffer.from(dataBase64, 'base64');
  const expected = (
    { 'image/jpeg': 'jpeg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>
  )[contentType];
  if (
    !expected ||
    bytes.length === 0 ||
    bytes.length > MAX_PHOTO_BYTES ||
    !photoSignature(bytes, contentType)
  )
    throw invalidPhoto();
  if (activeDecoders >= 2) {
    throw fail(
      HttpStatus.TOO_MANY_REQUESTS,
      'photo_validation_busy',
      'Há fotos em processamento. A foto local continua pendente; tente novamente.',
    );
  }
  activeDecoders++;
  try {
    const image = sharp(bytes, { limitInputPixels: MAX_PHOTO_PIXELS, failOn: 'warning' });
    const metadata = await image.metadata();
    if (
      metadata.format !== expected ||
      !metadata.width ||
      !metadata.height ||
      metadata.width * metadata.height > MAX_PHOTO_PIXELS ||
      (metadata.pages ?? 1) !== 1
    ) {
      throw new Error('Unsupported image');
    }
    // metadata() only reads headers. stats() actually decodes the image without
    // allocating a raw pixel buffer in JavaScript or accepting a signature-only file.
    await image.stats();
    return bytes;
  } catch {
    throw invalidPhoto();
  } finally {
    activeDecoders--;
  }
}

function invalidPhoto() {
  return fail(
    HttpStatus.BAD_REQUEST,
    'invalid_photo',
    'Envie uma foto JPEG, PNG ou WebP válida, de até 5 MB e 25 megapixels.',
  );
}

function photoSignature(bytes: Buffer, contentType: string): boolean {
  if (contentType === 'image/jpeg')
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (contentType === 'image/png')
    return bytes
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return (
    contentType === 'image/webp' &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  );
}
