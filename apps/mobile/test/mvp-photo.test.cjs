const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, deferred } = require('./support/sqlite-harness.cjs');
const PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1cAAAAASUVORK5CYII=';
async function setup(t) {
  const h = await harness();
  t.after(() => h.close());
  const remote = new Map();
  h.api.uploadEquipmentPhotoRequest = async (_gym, id, type, data) => {
    remote.set(id, { type, data });
  };
  h.api.deleteEquipmentPhotoRequest = async (_gym, id) => {
    remote.delete(id);
  };
  return { h, remote };
}
const save = (h, data = PNG, online = false) =>
  h.catalog.saveEquipmentPhoto(h.user, h.gym.id, h.equipment.id, 'image/png', data, online);
const read = (h) => h.catalog.readLocalEquipment(h.user, h.equipment.id);

test('photo persists in file SQLite across runtime restart; upload and equipment association survive', async (t) => {
  const { h, remote } = await setup(t);
  await save(h);
  assert.equal(await h.catalog.countPendingOperations(h.user), 1);
  await h.reopen();
  const local = await read(h);
  assert.equal(local.photoUri, `data:image/png;base64,${PNG}`);
  assert.equal(local.photoPending, true);
  assert.deepEqual(Array.from(local.exerciseIds), [h.exercise.id]);
  await h.catalog.syncCatalog(h.user);
  assert.equal((await read(h)).photoPending, false);
  assert.equal(remote.get(h.equipment.id).data, PNG);
  assert.equal(await h.catalog.countPendingOperations(h.user), 0);
});

test('lost ACK leaves photo durable; restart/retry sends same bytes', async (t) => {
  const { h, remote } = await setup(t);
  const send = h.api.uploadEquipmentPhotoRequest;
  h.api.uploadEquipmentPhotoRequest = async (...args) => {
    await send(...args);
    throw new h.errors.ApiClientError('offline', 0, 'network_error');
  };
  await save(h, PNG, true);
  assert.equal((await read(h)).photoPending, true);
  assert.equal(remote.size, 1);
  await h.reopen();
  h.api.uploadEquipmentPhotoRequest = send;
  await h.catalog.syncCatalog(h.user);
  assert.equal(remote.size, 1);
  assert.equal((await read(h)).photoPending, false);
});

test('late upload ACK cannot erase a newer photo or pending delete', async (t) => {
  const { h } = await setup(t);
  for (const choice of ['replace', 'delete']) {
    await save(h);
    const sent = deferred(),
      release = deferred();
    h.api.uploadEquipmentPhotoRequest = async () => {
      sent.resolve();
      await release.promise;
    };
    const syncing = h.catalog.syncCatalog(h.user);
    await sent.promise;
    if (choice === 'replace') await save(h, 'bmV3LWltYWdl');
    else await h.catalog.removeEquipmentPhoto(h.user, h.gym.id, h.equipment.id, false);
    const before = await h.db.getFirstAsync(
      'SELECT photo_pending,photo_base64 FROM equipment WHERE id = ?',
      h.equipment.id,
    );
    release.resolve();
    await syncing;
    const after = await h.db.getFirstAsync(
      'SELECT photo_pending,photo_base64 FROM equipment WHERE id = ?',
      h.equipment.id,
    );
    // Deletes may have been flushed later in the same sync, but a replacement must stay pending.
    if (choice === 'replace') assert.deepEqual(after, before);
    else {
      assert.equal(after.photo_base64, null);
      assert.equal((await read(h)).hasPhoto, false);
    }
  }
});

test('a downloaded image cannot overwrite a pending local photo; wrong gym cannot write', async (t) => {
  const { h } = await setup(t);
  await save(h);
  await h.catalog.cacheDownloadedPhoto(h.user, h.equipment.id, 'data:image/png;base64,b2xk');
  assert.equal((await read(h)).photoUri, `data:image/png;base64,${PNG}`);
  await assert.rejects(() =>
    h.catalog.saveEquipmentPhoto(h.user, 'wrong-gym', h.equipment.id, 'image/png', PNG, false),
  );
  assert.equal((await read(h)).photoPending, true);
});

test('HTTP failure preserves the photo for actionable retry', async (t) => {
  const { h } = await setup(t);
  h.api.uploadEquipmentPhotoRequest = async () => {
    throw new h.errors.ApiClientError('invalid', 400, 'invalid_photo');
  };
  await assert.rejects(() => save(h, PNG, true));
  assert.equal((await read(h)).photoPending, true);
  assert.equal((await read(h)).photoUri, `data:image/png;base64,${PNG}`);
});

test('permission denial is explicit; malformed, oversized and unknown formats fail before persistence', async (t) => {
  const { h } = await setup(t);
  const policy = h.load('catalog/photo-policy');
  assert.equal(policy.photoPermissionAction({ granted: false, canAskAgain: true }), 'explain');
  assert.equal(policy.photoPermissionAction({ granted: false, canAskAgain: false }), 'settings');
  assert.equal(policy.photoPermissionAction({ granted: true, canAskAgain: true }), 'capture');
  const valid = { base64: PNG, mimeType: 'image/png', width: 1, height: 1 };
  assert.equal(policy.prepareEquipmentPhoto(valid).dataBase64, PNG);
  assert.equal(
    policy.prepareEquipmentPhoto({ ...valid, mimeType: 'image/jpeg' }).contentType,
    'image/png',
  );
  assert.equal(
    policy.prepareEquipmentPhoto({
      ...valid,
      base64: Buffer.from([0xff, 0xd8, 0xff, 0]).toString('base64'),
      mimeType: 'image/heic',
    }).contentType,
    'image/jpeg',
  );
  for (const bad of [
    { base64: '%%%' },
    { base64: Buffer.from('unsupported format').toString('base64') },
    { width: 0 },
    { height: 30_000_000 },
    { base64: Buffer.alloc(5 * 1024 * 1024 + 1).toString('base64') },
  ]) {
    assert.throws(() => policy.prepareEquipmentPhoto({ ...valid, ...bad }));
  }
  assert.equal((await read(h)).photoUri, null);
});

test('remote equipment absence cannot silently delete an unsent local photo', async (t) => {
  const { h } = await setup(t);
  await save(h);
  h.remote.equipment.length = 0;
  h.api.uploadEquipmentPhotoRequest = async () => {
    throw new h.errors.ApiClientError('not found', 404, 'not_found');
  };
  await assert.rejects(() => h.catalog.syncCatalog(h.user));
  assert.equal((await read(h)).photoUri, `data:image/png;base64,${PNG}`);
  assert.equal((await read(h)).photoPending, true);
});
