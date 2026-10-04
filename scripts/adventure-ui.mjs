import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getWorld } from '../src/playground/worlds.js';
import { checkPostcardSharing, checkAlbumSharing, checkLegacyPostcard } from './sharing-ui.mjs';

export async function checkAdventures({ page, check, base, appUrl, state, status, chooseWorld }) {
  await check(`${base} real scene postcard, PNG download, album, pause and nested focus`, async () => {
    await page.locator('[data-portrait]').click(); assert.equal((await state()).following, false);
    await page.locator('[data-photo]').click(); await status('paused');
    assert(await page.locator('.playground-journal').isVisible());
    assert(await page.locator('.playground-footer').evaluate(node => node.inert)); assert.equal((await state()).photos, 1);
    await page.waitForTimeout(150); const time = (await state()).pose.time; await page.waitForTimeout(150); assert.equal((await state()).pose.time, time);
    await page.keyboard.press('Shift+Tab'); assert(await page.locator('[data-photo-album]').evaluate(node => node === document.activeElement));
    const downloadPromise = page.waitForEvent('download'); await page.locator('[data-photo-download]').click();
    const download = await downloadPromise, bytes = await readFile(await download.path());
    assert.equal(bytes.subarray(1, 4).toString(), 'PNG'); assert.equal(bytes.readUInt32BE(16), 1400); assert.equal(bytes.readUInt32BE(20), 1200);
    await checkPostcardSharing({ page, check, base, appUrl, bytes });
    await checkLegacyPostcard({ page, check, base, appUrl });
    await page.keyboard.press('Escape'); assert(!(await page.locator('.playground-journal').isVisible()));
    assert.equal(await page.locator('#playground-dialog').getAttribute('open'), ''); assert.equal((await state()).status, 'paused');
    assert.equal(await page.locator('.playground-footer').evaluate(node => node.inert), false);
    await page.locator('[data-album]').click(); assert.equal(await page.locator('[data-memory]').count(), 1);
    await checkAlbumSharing({ page, check, base });
    await page.locator('[data-memory-delete]').click(); assert.equal(await page.locator('[data-memory]').count(), 0);
    await page.locator('[data-journal-close]').click();
  });
  // Pose fixtures enter through the instrumented worker boundary. Actual
  // route reachability is checked separately by validate-worlds with MuJoCo.
  const freezeWorker = async () => { await page.evaluate(() => window.__workers.instances.findLast(worker => !worker.stopped).postMessage({ type: 'pause' })); await page.waitForTimeout(150); };
  const inject = async point => page.evaluate(point => {
    const worker = window.__workers.instances.findLast(worker => !worker.stopped), pose = structuredClone(window.duckrobe.playground.getState().pose);
    pose.time += 1; pose.root[0] = point[0]; pose.root[1] = point[1]; worker.onmessage({ data: { type: 'pose', pose } });
  }, point);
  await check(`${base} garden and mail pose fixtures, scenery feedback and progress reset`, async () => {
    await chooseWorld('park'); await freezeWorker(); await inject(getWorld('park').interactions[0].pos);
    assert(await page.locator('[data-interact]').isEnabled()); await page.locator('[data-interact]').click();
    assert.deepEqual((await state()).interactions.completed, ['garden']); await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => window.duckrobe.playground.rig.group.parent.parent.getObjectByName('park-garden-blooms').scale.z), 1);
    assert(!(await page.locator('[data-interaction]').isVisible()));
    await chooseWorld('harbor'); await freezeWorker(); const [office, ...destinations] = getWorld('harbor').interactions;
    await inject(destinations[0].pos); assert(await page.locator('[data-interact]').isDisabled());
    await inject(office.pos); await page.locator('[data-interact]').click(); assert((await state()).interactions.carrying);
    for (const point of destinations) { await inject(point.pos); await page.locator('[data-interact]').click(); }
    assert.equal((await state()).interactions.delivered.length, 3); assert.equal(await page.locator('.playground-stamps .collected').count(), 3);
    await chooseWorld('park'); assert.deepEqual((await state()).interactions.completed, []); await chooseWorld('circuit');
  });
  await check(`${base} lap pose fixtures persist, animate replay, pause and clear records`, async () => {
    await freezeWorker();
    const cross = async index => { const gate = getWorld('circuit').gates[index]; await inject(gate.pos.map((value, i) => value - gate.normal[i] * .02)); await inject(gate.pos.map((value, i) => value + gate.normal[i] * .02)); };
    await cross(0); await cross(1); await cross(2); await cross(3); await cross(0);
    assert.equal((await state()).record.duration, 8); assert.equal((await state()).record.splits.length, 4);
    await page.locator('[data-replay]').click(); await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => window.duckrobe.playground.rig.group.parent.parent.getObjectByName('best-lap-duck').parent.visible), true);
    const replayPosition = () => page.evaluate(() => window.duckrobe.playground.rig.group.parent.parent.getObjectByName('best-lap-duck').getObjectByName('trunk_base').position.toArray());
    const before = await replayPosition(); await inject(getWorld('circuit').gates[1].pos); await page.waitForTimeout(150); assert.notDeepEqual(await replayPosition(), before);
    await page.locator('[data-pause]').click(); await status('paused'); const frozen = await replayPosition(); await page.waitForTimeout(150); assert.deepEqual(await replayPosition(), frozen);
    await chooseWorld('arena'); await chooseWorld('circuit'); assert.equal((await state()).record.duration, 8);
    await page.locator('[data-clear-record]').click(); assert.equal((await state()).record, null); assert(await page.locator('[data-replay]').isDisabled());
    await chooseWorld('arena'); await chooseWorld('circuit'); assert.equal((await state()).record, null);
  });
}

export async function checkAlbumRestore({ page, check, base, enter, exit, before }) {
  await check(`${base} travel album persists across visits and restores the selected outfit`, async () => {
    await enter(); await page.locator('[data-photo]').click(); await page.locator('[data-journal-close]').click(); await exit();
    await page.evaluate(() => window.duckrobe.selectLook('harbour-day')); await enter();
    await page.locator('[data-album]').click(); assert.equal(await page.locator('[data-memory]').count(), 1);
    await page.locator('[data-memory-wear]').click(); assert.equal(await page.locator('#playground-dialog').getAttribute('open'), null);
    assert.deepEqual(await page.evaluate(() => window.duckrobe.state.selection), before.state.selection);
    assert.deepEqual(await page.evaluate(() => window.duckrobe.state.colors), before.state.colors); assert.equal(await page.evaluate(() => window.__workers.active), 0);
  });
}
