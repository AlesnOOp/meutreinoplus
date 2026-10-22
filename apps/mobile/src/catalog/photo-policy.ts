export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const MAX_PHOTO_PIXELS = 25_000_000;

export function photoPermissionAction(permission: { granted: boolean; canAskAgain: boolean }) {
  return permission.granted ? 'capture' : permission.canAskAgain ? 'explain' : 'settings';
}

export function prepareEquipmentPhoto(asset: {
  base64?: string | null;
  mimeType?: string | null;
  width: number;
  height: number;
}): { contentType: 'image/jpeg' | 'image/png' | 'image/webp'; dataBase64: string } {
  const dataBase64 = asset.base64;
  if (!dataBase64 || dataBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataBase64)) {
    throw new Error('Não foi possível ler a foto. Escolha outra imagem.');
  }
  // ImagePicker can encode JPEG while mimeType still describes the original asset.
  // Infer the transport MIME from the actual payload; native and server decoders
  // below this boundary still validate the entire image.
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const header: number[] = [];
  let bits = 0,
    value = 0;
  for (const char of dataBase64.slice(0, 16)) {
    if (char === '=') break;
    value = (value << 6) | alphabet.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      header.push((value >>> bits) & 255);
    }
  }
  const signature = (start: number, expected: number[]) =>
    expected.every((byte, index) => header[start + index] === byte);
  const contentType = signature(0, [0xff, 0xd8, 0xff])
    ? 'image/jpeg'
    : signature(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      ? 'image/png'
      : signature(0, [0x52, 0x49, 0x46, 0x46]) && signature(8, [0x57, 0x45, 0x42, 0x50])
        ? 'image/webp'
        : null;
  if (!contentType) throw new Error('Use uma imagem JPEG, PNG ou WebP.');
  const bytes =
    (dataBase64.length * 3) / 4 -
    (dataBase64.endsWith('==') ? 2 : dataBase64.endsWith('=') ? 1 : 0);
  if (bytes > MAX_PHOTO_BYTES)
    throw new Error('A imagem precisa ter até 5 MB. Escolha uma foto menor.');
  if (
    !Number.isSafeInteger(asset.width) ||
    !Number.isSafeInteger(asset.height) ||
    asset.width <= 0 ||
    asset.height <= 0 ||
    asset.width * asset.height > MAX_PHOTO_PIXELS
  ) {
    throw new Error('Use uma imagem de até 25 megapixels com dimensões válidas.');
  }
  return { contentType, dataBase64 };
}
