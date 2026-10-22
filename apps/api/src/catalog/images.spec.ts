import sharp from 'sharp';
import { crc32 } from 'node:zlib';
import { decodeImage } from './images';

const photo = () => sharp({ create: { width: 4, height: 4, channels: 3, background: '#4682b4' } });

describe('Equipment photo decoding', () => {
  it.each(['jpeg', 'png', 'webp'] as const)('fully decodes a valid %s photo', async (format) => {
    const bytes = await photo().toFormat(format).toBuffer();
    expect(await decodeImage(bytes.toString('base64'), `image/${format}`)).toEqual(bytes);
  });
  it('rejects malformed base64, empty bytes, MIME mismatch and signature-only files', async () => {
    const png = await photo().png().toBuffer();
    for (const [data, type] of [
      ['%%%%', 'image/png'],
      ['', 'image/png'],
      [png.toString('base64'), 'image/jpeg'],
      [
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64'),
        'image/png',
      ],
      [Buffer.from([0xff, 0xd8, 0xff, 0]).toString('base64'), 'image/jpeg'],
      [Buffer.from('RIFF1234WEBP').toString('base64'), 'image/webp'],
    ])
      await expect(decodeImage(data, type)).rejects.toMatchObject({ status: 400 });
  });
  it('rejects a truncated PNG after valid metadata', async () => {
    const png = await photo().png().toBuffer();
    await expect(
      decodeImage(png.subarray(0, 45).toString('base64'), 'image/png'),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('rejects oversized encoded input and an image with excessive declared pixel dimensions', async () => {
    await expect(
      decodeImage(Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64'), 'image/png'),
    ).rejects.toMatchObject({ status: 400 });
    const png = await photo().png().toBuffer();
    png.writeUInt32BE(100_000, 16);
    png.writeUInt32BE(100_000, 20);
    png.writeUInt32BE(crc32(png.subarray(12, 29)), 29);
    await expect(decodeImage(png.toString('base64'), 'image/png')).rejects.toMatchObject({
      status: 400,
    });
  });
});
