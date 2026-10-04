import { ITEMS, OUTFITS, normalizeSelection, selectedItemIds, selectionKey } from '../outfits.js';
import { normalizeRobotColors } from '../robot.js';
import { localized, t } from '../i18n.js';

function describeLook(look, language) {
  const selection = normalizeSelection(look.selection);
  const outfit = OUTFITS.find(outfit => selectionKey(outfit.selection) === selectionKey(selection));
  const pieces = selectedItemIds(selection).map(id => localized(ITEMS.find(item => item.id === id), language));
  return { name: outfit ? localized(outfit, language) : t(pieces.length ? 'mixName' : 'bareName', language), pieces, colors: normalizeRobotColors(look.colors) };
}

const PAPER = '#f4ead5', INK = '#40594c';
export const POSTCARD_WIDTH = 1400, POSTCARD_HEIGHT = 1200;

function signature(canvas, photo, language) {
  const ctx = canvas.getContext('2d'), look = describeLook(photo, language);
  ctx.fillStyle = PAPER; ctx.fillRect(0, 900, POSTCARD_WIDTH, 300);
  ctx.fillStyle = '#9c7560'; ctx.font = '22px Georgia'; ctx.fillText(`DUCKROBE / ${photo.place}`, 54, 938, 930);
  ctx.fillStyle = INK; ctx.font = '500 36px Georgia'; ctx.fillText(photo.look || look.name, 54, 986, 930);
  ctx.font = '23px sans-serif';
  let line = '', y = 1027;
  for (const piece of look.pieces) {
    const next = line ? `${line} · ${piece}` : piece;
    if (line && ctx.measureText(next).width > 930) { ctx.fillText(line, 54, y, 930); y += 30; line = piece; }
    else line = next;
  }
  if (line) ctx.fillText(line, 54, y, 930);
  for (const [index, color] of Object.values(look.colors).entries()) {
    ctx.beginPath(); ctx.arc(65 + index * 32, 1140, 11, 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#826d5766'; ctx.lineWidth = 1; ctx.stroke();
  }
  ctx.fillStyle = '#826d57'; ctx.font = '21px sans-serif';
  ctx.fillText(new Date(photo.isoDate || photo.date).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-GB'), 130, 1148, 470);
  ctx.font = '18px Georgia'; ctx.textAlign = 'right'; ctx.fillText(photo.badge || 'LITTLE TRAVELS', 1000, 1148, 250); ctx.textAlign = 'left';

  return canvas;
}
function blank() {
  const canvas = document.createElement('canvas'); canvas.width = POSTCARD_WIDTH; canvas.height = POSTCARD_HEIGHT;
  const ctx = canvas.getContext('2d'); ctx.fillStyle = PAPER; ctx.fillRect(0, 0, canvas.width, canvas.height);
  return canvas;
}
export function makePostcard(renderer, scene, camera, photo, language) {
  renderer.render(scene, camera);
  const canvas = blank(), ctx = canvas.getContext('2d'), image = renderer.domElement;
  const scale = Math.min(1320 / image.width, 820 / image.height), width = image.width * scale, height = image.height * scale;
  ctx.fillStyle = '#dcd5bf'; ctx.fillRect(40, 40, 1320, 820); ctx.drawImage(image, 40 + (1320 - width) / 2, 40 + (820 - height) / 2, width, height);
  return signature(canvas, photo, language);
}
export async function restorePostcard(photo, language) {
  const image = new Image(); image.src = photo.image; await image.decode();
  const canvas = blank();
  // Older album pages used a 1400×1100 card. Keep the photograph in place
  // and typeset a fresh signature instead of enlarging a blurry code.
  const ctx = canvas.getContext('2d');
  if (photo.postcardVersion === 2) ctx.drawImage(image, 0, 0, image.naturalWidth, image.naturalHeight * 860 / POSTCARD_HEIGHT, 0, 0, POSTCARD_WIDTH, 860);
  else {
    const sx = image.naturalWidth / 1400, sy = image.naturalHeight / 1100, width = 1320 * 820 / 850;
    ctx.fillStyle = '#dcd5bf'; ctx.fillRect(40, 40, 1320, 820);
    ctx.drawImage(image, 40 * sx, 40 * sy, 1320 * sx, 850 * sy, 40 + (1320 - width) / 2, 40, width, 820);
  }
  return signature(canvas, photo, photo.language || language);
}
