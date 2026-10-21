import { HttpStatus } from '@nestjs/common';
import { fail } from '../identity/http';

const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

export function decodeImage(dataBase64: string, contentType: string): Buffer {
  const bytes = Buffer.from(dataBase64, 'base64');
  if (bytes.length === 0 || bytes.length > MAX_PHOTO_BYTES || !magicMatches(bytes, contentType)) {
    throw fail(
      HttpStatus.BAD_REQUEST,
      'invalid_photo',
      'Envie uma imagem JPEG, PNG ou WebP de até 5 MB.',
    );
  }
  return bytes;
}

function magicMatches(bytes: Buffer, contentType: string): boolean {
  if (contentType === 'image/jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/png') {
    return bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  }
  if (contentType === 'image/webp') {
    return (
      bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
    );
  }
  return false;
}
