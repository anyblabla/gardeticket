const APP_VERSION = '2.6';
const THEME_COLORS = {
  teal: '#1C7176',
  ocean: '#1D4ED8',
  indigo: '#4338CA',
  forest: '#15803D',
  plum: '#7E22CE',
  magenta: '#A21CAF',
  crimson: '#BE123C',
  slate: '#334155'
};
const DB_NAME = 'GardeTicketDB';
const STORE_NAME = 'tickets';
let db;
let rawSelectedImage = '';
let currentRotation = 0;
let currentMediaData = '';
let currentMediaType = 'image';
let currentTicket = null;
let editingTicketId = null;
let currentFilter = 'all';
let pendingImportItems = [];

function initDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => {
      db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e);
  });
}

// Détection précise du ticket blanc (Otsu + composante centrale + resserrement des bords)
function detectTicketBounds(sourceCanvas) {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;
  const sampleW = 160;
  const scale = sampleW / w;
  const sampleH = Math.max(40, Math.round(h * scale));

  const c = document.createElement('canvas');
  c.width = sampleW;
  c.height = sampleH;
  const ctx = c.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0, sampleW, sampleH);
  const data = ctx.getImageData(0, 0, sampleW, sampleH).data;

  const total = sampleW * sampleH;
  const scores = new Uint8Array(total);
  const hist = new Array(256).fill(0);

  for (let i = 0, p = 0; p < total; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luma = (r + g + b) / 3;
    const sat = Math.max(r, g, b) - Math.min(r, g, b);
    const val = Math.max(0, Math.min(255, Math.round(luma - sat * 1.6)));
    scores[p] = val;
    hist[val]++;
  }

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = 0, threshold = 135;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const varBetween = wB * wF * (mB - mF) * (mB - mF);
    if (varBetween > maxVar) {
      maxVar = varBetween;
      threshold = t;
    }
  }
  threshold = Math.max(95, Math.min(215, threshold + 8));

  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const cxMin = Math.floor(sampleW * 0.25);
  const cxMax = Math.floor(sampleW * 0.75);
  const cyMin = Math.floor(sampleH * 0.25);
  const cyMax = Math.floor(sampleH * 0.75);

  let bestMask = null;
  let bestBounds = null;
  let bestScore = 0;

  for (let y = 0; y < sampleH; y++) {
    for (let x = 0; x < sampleW; x++) {
      const startIdx = y * sampleW + x;
      if (visited[startIdx] || scores[startIdx] < threshold) continue;

      let head = 0, tail = 0;
      queue[tail++] = startIdx;
      visited[startIdx] = 1;

      let minX = x, maxX = x, minY = y, maxY = y;
      let area = 0, centerHits = 0;

      while (head < tail) {
        const curr = queue[head++];
        const cx = curr % sampleW;
        const cy = (curr - cx) / sampleW;

        area++;
        if (cx >= cxMin && cx <= cxMax && cy >= cyMin && cy <= cyMax) centerHits++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        if (cx > 0) { const n = curr - 1; if (!visited[n] && scores[n] >= threshold) { visited[n] = 1; queue[tail++] = n; } }
        if (cx < sampleW - 1) { const n = curr + 1; if (!visited[n] && scores[n] >= threshold) { visited[n] = 1; queue[tail++] = n; } }
        if (cy > 0) { const n = curr - sampleW; if (!visited[n] && scores[n] >= threshold) { visited[n] = 1; queue[tail++] = n; } }
        if (cy < sampleH - 1) { const n = curr + sampleW; if (!visited[n] && scores[n] >= threshold) { visited[n] = 1; queue[tail++] = n; } }
      }

      if (centerHits > 0 && area > total * 0.015) {
        const blobScore = area + centerHits * 3;
        if (blobScore > bestScore) {
          bestScore = blobScore;
          bestBounds = { minX, maxX, minY, maxY };
          bestMask = new Uint8Array(total);
          for (let k = 0; k < tail; k++) bestMask[queue[k]] = 1;
        }
      }
    }
  }

  if (!bestBounds || !bestMask) {
    return { x: 0, y: 0, w, h };
  }

  let { minX, maxX, minY, maxY } = bestBounds;
  const rawW = maxX - minX + 1;
  const rawH = maxY - minY + 1;

  while (minY < maxY) {
    let cnt = 0;
    for (let x = minX; x <= maxX; x++) if (bestMask[minY * sampleW + x]) cnt++;
    if (cnt >= rawW * 0.45) break;
    minY++;
  }
  while (maxY > minY) {
    let cnt = 0;
    for (let x = minX; x <= maxX; x++) if (bestMask[maxY * sampleW + x]) cnt++;
    if (cnt >= rawW * 0.45) break;
    maxY--;
  }
  while (minX < maxX) {
    let cnt = 0;
    for (let y = minY; y <= maxY; y++) if (bestMask[y * sampleW + minX]) cnt++;
    if (cnt >= rawH * 0.45) break;
    minX++;
  }
  while (maxX > minX) {
    let cnt = 0;
    for (let y = minY; y <= maxY; y++) if (bestMask[y * sampleW + maxX]) cnt++;
    if (cnt >= rawH * 0.45) break;
    maxX--;
  }

  const boxW = maxX - minX;
  const boxH = maxY - minY;
  if (boxW < sampleW * 0.12 || boxH < sampleH * 0.12) {
    return { x: 0, y: 0, w, h };
  }

  const padX = Math.max(2, Math.round(boxW * 0.03));
  const padY = Math.max(2, Math.round(boxH * 0.03));
  const sx = Math.max(0, Math.round((minX - padX) / scale));
  const sy = Math.max(0, Math.round((minY - padY) / scale));
  const sw = Math.min(w - sx, Math.round((boxW + padX * 2) / scale));
  const sh = Math.min(h - sy, Math.round((boxH + padY * 2) / scale));

  return { x: sx, y: sy, w: sw, h: sh };
}

function applyScannerFilter(canvas) {
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imgData.data;

  for (let i = 0; i < d.length; i += 4) {
    const gray = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    let val = (gray - 128) * 1.65 + 142;
    val = Math.max(0, Math.min(255, val));
    d[i] = d[i + 1] = d[i + 2] = val;
  }
  ctx.putImageData(imgData, 0, 0);
}

function processImage(dataUrl, mode, rotationDeg = 0, manualPct = null, bwMode = false) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const rotCanvas = document.createElement('canvas');
      const isSideways = rotationDeg === 90 || rotationDeg === 270;
      rotCanvas.width = isSideways ? img.height : img.width;
      rotCanvas.height = isSideways ? img.width : img.height;

      const rCtx = rotCanvas.getContext('2d');
      rCtx.translate(rotCanvas.width / 2, rotCanvas.height / 2);
      rCtx.rotate((rotationDeg * Math.PI) / 180);
      rCtx.drawImage(img, -img.width / 2, -img.height / 2);

      let crop = { x: 0, y: 0, w: rotCanvas.width, h: rotCanvas.height };

      if (mode === 'auto') {
        crop = detectTicketBounds(rotCanvas);
      } else if (mode === 'manual' && manualPct) {
        const sx = Math.round(rotCanvas.width * (manualPct.left / 100));
        const sy = Math.round(rotCanvas.height * (manualPct.top / 100));
        const sw = Math.max(20, Math.round(rotCanvas.width * (1 - (manualPct.left + manualPct.right) / 100)));
        const sh = Math.max(20, Math.round(rotCanvas.height * (1 - (manualPct.top + manualPct.bottom) / 100)));
        crop = { x: sx, y: sy, w: sw, h: sh };
      }

      const maxW = 1000;
      const scale = crop.w > maxW ? maxW / crop.w : 1;
      const outCanvas = document.createElement('canvas');
      outCanvas.width = Math.round(crop.w * scale);
      outCanvas.height = Math.round(crop.h * scale);

      const oCtx = outCanvas.getContext('2d');
      oCtx.drawImage(rotCanvas, crop.x, crop.y, crop.w, crop.h, 0, 0, outCanvas.width, outCanvas.height);

      if (bwMode) {
        applyScannerFilter(outCanvas);
      }

      resolve(outCanvas.toDataURL('image/jpeg', bwMode ? 0.72 : 0.78));
    };
    img.src = dataUrl;
  });
}

function escapeHTML(str) {
  return str.replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function getWarrantyStatus(purchaseDate, years) {
  if (parseInt(years) === 99) {
    return { status: 'ok', label: 'À vie', endStr: 'Garantie à vie' };
  }
  const end = new Date(purchaseDate);
  end.setFullYear(end.getFullYear() + parseInt(years));
  const now = new Date();
  const diffDays = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  const endStr = end.toLocaleDateString('fr-BE');

  if (diffDays < 0) return { status: 'expired', label: 'Expirée', endStr };
  if (diffDays <= 90) return { status: 'warn', label: `${diffDays} j restants`, endStr };
  return { status: 'ok', label: `Fin : ${endStr}`, endStr };
}

function renderTickets() {
  const searchTerm = document.getElementById('search').value.toLowerCase();
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);

  store.getAll().onsuccess = (e) => {
    const list = document.getElementById('tickets-list');
    list.innerHTML = '';

    const allTickets = e.target.result
      .map(t => ({ ...t, warranty: getWarrantyStatus(t.purchaseDate, t.warrantyYears) }));

    const warnCount = allTickets.filter(t => t.warranty.status === 'warn').length;
    const alertBanner = document.getElementById('expiry-alert-banner');
    if (warnCount > 0 && currentFilter !== 'warn') {
      alertBanner.innerHTML = `<span>⚠️ ${warnCount} garantie${warnCount > 1 ? 's' : ''} arrive${warnCount > 1 ? 'nt' : ''} bientôt à échéance</span><span class="alert-cta">Voir →</span>`;
      alertBanner.classList.remove('hidden');
    } else {
      alertBanner.classList.add('hidden');
    }

    const tickets = allTickets
      .filter(t => {
        const matchText = t.name.toLowerCase().includes(searchTerm)
          || (t.store || '').toLowerCase().includes(searchTerm)
          || (t.notes || '').toLowerCase().includes(searchTerm);
        const matchStatus = currentFilter === 'all' || t.warranty.status === currentFilter;
        return matchText && matchStatus;
      })
      .sort((a, b) => new Date(b.purchaseDate) - new Date(a.purchaseDate));

    if (tickets.length === 0) {
      list.innerHTML = '<p class="empty-msg">Aucun ticket trouvé.</p>';
      return;
    }

    tickets.forEach(ticket => {
      const w = ticket.warranty;
      const isPdf = ticket.mediaType === 'pdf' || (ticket.image && ticket.image.startsWith('data:application/pdf'));
      const div = document.createElement('div');
      div.className = `ticket-item ${w.status}`;
      div.innerHTML = `
        <div class="ticket-info">
          <h3>${isPdf ? '📄 ' : ''}${escapeHTML(ticket.name)}</h3>
          <p>${ticket.store ? escapeHTML(ticket.store) + ' • ' : ''}Acheté le ${new Date(ticket.purchaseDate).toLocaleDateString('fr-BE')}${ticket.price ? ' • ' + escapeHTML(ticket.price) + ' €' : ''}</p>
        </div>
        <span class="badge ${w.status}">${w.label}</span>
      `;
      div.onclick = () => openModal(ticket, w);
      list.appendChild(div);
    });
  };
}

function openModal(ticket, warranty) {
  currentTicket = ticket;
  const isPdf = ticket.mediaType === 'pdf' || (ticket.image && ticket.image.startsWith('data:application/pdf'));

  document.getElementById('modal-title').textContent = ticket.name;
  document.getElementById('modal-details').textContent =
    `${ticket.store ? ticket.store + ' — ' : ''}Acheté le ${new Date(ticket.purchaseDate).toLocaleDateString('fr-BE')} (Fin garantie : ${warranty.endStr})`;

  const btnReminder = document.getElementById('btn-reminder');
  if (parseInt(ticket.warrantyYears) === 99 || warranty.status === 'expired') {
    btnReminder.classList.add('hidden');
  } else {
    btnReminder.classList.remove('hidden');
  }

  const notesEl = document.getElementById('modal-notes');
  if (ticket.notes && ticket.notes.trim()) {
    notesEl.textContent = `📝 ${ticket.notes.trim()}`;
    notesEl.classList.remove('hidden');
  } else {
    notesEl.classList.add('hidden');
  }

  const imgWrap = document.getElementById('modal-img-wrap');
  const pdfBox = document.getElementById('modal-pdf-box');

  if (isPdf) {
    imgWrap.classList.add('hidden');
    pdfBox.classList.remove('hidden');
    document.getElementById('modal-pdf').src = ticket.image;
    const link = document.getElementById('btn-open-pdf');
    link.href = ticket.image;
    link.download = `${ticket.name.replace(/[^a-z0-9]/gi, '_')}.pdf`;
  } else {
    pdfBox.classList.add('hidden');
    imgWrap.classList.remove('hidden');
    document.getElementById('modal-img').src = ticket.image;
  }

  document.getElementById('modal-ticket').showModal();
}

function escapeICS(str) {
  return (str || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function formatICSDate(dateObj, timePart = '090000') {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}${m}${d}T${timePart}`;
}

function downloadWarrantyReminder(ticket) {
  const years = parseInt(ticket.warrantyYears);
  if (years === 99) return;

  const end = new Date(ticket.purchaseDate);
  end.setFullYear(end.getFullYear() + years);
  const endStr = end.toLocaleDateString('fr-BE');

  const reminderDate = new Date(end);
  reminderDate.setDate(reminderDate.getDate() - 30);
  const now = new Date();
  if (reminderDate < now) {
    reminderDate.setTime(now.getTime());
    reminderDate.setDate(reminderDate.getDate() + 1);
  }

  const dtStamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const dtStart = formatICSDate(reminderDate, '090000');
  const dtEnd = formatICSDate(reminderDate, '093000');

  const descParts = [
    `La garantie de "${ticket.name}"${ticket.store ? ` (acheté chez ${ticket.store})` : ''} expire le ${endStr}.`
  ];
  if (ticket.notes && ticket.notes.trim()) {
    descParts.push(`Note / N° de série : ${ticket.notes.trim()}`);
  }
  descParts.push('Pense à vérifier ton appareil et retrouver ton justificatif dans GardeTicket.');

  const icsContent = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GardeTicket//BlablaLinux//FR',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:gardeticket-${ticket.id}@blablalinux.be`,
    `DTSTAMP:${dtStamp}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${escapeICS(`⚠️ Fin de garantie : ${ticket.name}`)}`,
    `DESCRIPTION:${escapeICS(descParts.join(' '))}`,
    'BEGIN:VALARM',
    'TRIGGER:-PT0M',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeICS(`Fin de garantie bientôt : ${ticket.name}`)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  const safeName = ticket.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'ticket';
  const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `rappel-garantie-${safeName}.ics`;
  a.click();
}

function resetManualSliders() {
  ['crop-top', 'crop-bottom', 'crop-left', 'crop-right'].forEach(id => {
    document.getElementById(id).value = 0;
  });
}

function resetFormState() {
  const form = document.getElementById('ticket-form');
  form.reset();
  editingTicketId = null;
  rawSelectedImage = '';
  currentRotation = 0;
  currentMediaData = '';
  currentMediaType = 'image';
  document.getElementById('form-title').textContent = 'Nouveau ticket';
  document.getElementById('file-req').textContent = '*';
  document.getElementById('purchase-date').valueAsDate = new Date();
  document.getElementById('photo-preview').classList.add('hidden');
  document.getElementById('pdf-preview').classList.add('hidden');
  document.getElementById('crop-option').classList.add('hidden');
  document.getElementById('manual-crop-box').classList.add('hidden');
  document.getElementById('auto-crop').checked = true;
  document.getElementById('bw-filter').checked = false;
  resetManualSliders();
}

async function refreshImagePreview() {
  if (!rawSelectedImage) return;
  const manualBox = document.getElementById('manual-crop-box');
  const isManual = !manualBox.classList.contains('hidden');
  const isAuto = document.getElementById('auto-crop').checked;
  const isBw = document.getElementById('bw-filter').checked;

  let mode = 'none';
  let manualPct = null;

  if (isManual) {
    mode = 'manual';
    manualPct = {
      top: parseInt(document.getElementById('crop-top').value),
      bottom: parseInt(document.getElementById('crop-bottom').value),
      left: parseInt(document.getElementById('crop-left').value),
      right: parseInt(document.getElementById('crop-right').value)
    };
  } else if (isAuto) {
    mode = 'auto';
  }

  currentMediaData = await processImage(rawSelectedImage, mode, currentRotation, manualPct, isBw);
  document.getElementById('photo-preview').src = currentMediaData;
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (ev) => {
    if (file.type === 'application/pdf') {
      currentMediaType = 'pdf';
      currentMediaData = ev.target.result;
      rawSelectedImage = '';
      document.getElementById('photo-preview').classList.add('hidden');
      document.getElementById('crop-option').classList.add('hidden');
      document.getElementById('manual-crop-box').classList.add('hidden');
      document.getElementById('pdf-preview').classList.remove('hidden');
    } else {
      currentMediaType = 'image';
      rawSelectedImage = ev.target.result;
      currentRotation = 0;
      resetManualSliders();
      document.getElementById('manual-crop-box').classList.add('hidden');
      document.getElementById('auto-crop').checked = true;
      await refreshImagePreview();

      document.getElementById('pdf-preview').classList.add('hidden');
      document.getElementById('crop-option').classList.remove('hidden');
      document.getElementById('photo-preview').classList.remove('hidden');
    }
  };
  reader.readAsDataURL(file);
}

function dataURLtoFile(dataUrl, filename) {
  const arr = dataUrl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) u8arr[n] = bstr.charCodeAt(n);
  return new File([u8arr], filename, { type: mime });
}

function getAllTicketsAsync() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = (e) => resolve(e.target.result || []);
    req.onerror = (e) => reject(e);
  });
}

// Empreinte unique d'un ticket pour détecter les doublons même si l'ID a changé
function getTicketSignature(t) {
  return `${(t.name || '').trim().toLowerCase()}|${t.purchaseDate || ''}|${(t.store || '').trim().toLowerCase()}|${t.price || ''}`;
}

function executeImport(items, replaceAll) {
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);

  if (replaceAll) {
    store.clear();
    const seenSigs = new Set();
    let count = 0;
    items.forEach(item => {
      if (!item || !item.name || !item.purchaseDate) return;
      const sig = getTicketSignature(item);
      if (seenSigs.has(sig)) return;
      seenSigs.add(sig);
      if (!item.id) item.id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
      store.put(item);
      count++;
    });
    tx.oncomplete = () => {
      alert(`${count} ticket(s) restauré(s) !`);
      renderTickets();
    };
  } else {
    store.getAll().onsuccess = (e) => {
      const existing = e.target.result;
      const existingIds = new Set(existing.map(t => t.id));
      const existingSigs = new Set(existing.map(getTicketSignature));
      let added = 0;
      let skipped = 0;

      items.forEach(item => {
        if (!item || !item.name || !item.purchaseDate) return;
        const sig = getTicketSignature(item);
        if ((item.id && existingIds.has(item.id)) || existingSigs.has(sig)) {
          skipped++;
          return;
        }
        if (!item.id) item.id = Date.now().toString() + Math.random().toString(36).slice(2, 6);
        existingIds.add(item.id);
        existingSigs.add(sig);
        store.put(item);
        added++;
      });

      tx.oncomplete = () => {
        alert(`${added} nouveau(x) ticket(s) ajouté(s)${skipped > 0 ? ` (${skipped} doublon(s) ignoré(s))` : ''} !`);
        renderTickets();
      };
    };
  }
}

function applyColorTheme(themeName) {
  const validTheme = THEME_COLORS[themeName] ? themeName : 'teal';
  if (validTheme === 'teal') {
    delete document.documentElement.dataset.theme;
  } else {
    document.documentElement.dataset.theme = validTheme;
  }
  localStorage.setItem('gardeticket_theme', validTheme);

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', THEME_COLORS[validTheme]);

  document.querySelectorAll('.theme-swatch').forEach(btn => {
    const isSelected = btn.dataset.theme === validTheme;
    btn.classList.toggle('active', isSelected);
    btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
  });
}

document.addEventListener('DOMContentLoaded', async () => {
  applyColorTheme(localStorage.getItem('gardeticket_theme') || 'teal');

  await initDB();
  resetFormState();
  renderTickets();

  if ('serviceWorker' in navigator) {
    let hadController = Boolean(navigator.serviceWorker.controller);
    let isRefreshing = false;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) {
        hadController = true;
        return;
      }
      if (isRefreshing) return;

      const formOpen = !document.getElementById('ticket-form').classList.contains('hidden');
      if (formOpen) {
        document.getElementById('update-banner').classList.remove('hidden');
      } else {
        isRefreshing = true;
        window.location.reload();
      }
    });

    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.update();
    }).catch(() => {});
  }

  document.getElementById('btn-reload-app').onclick = () => {
    window.location.reload();
  };

  // Sélecteur de thème par pastilles de couleur
  const btnTheme = document.getElementById('btn-theme');
  const themePicker = document.getElementById('theme-picker');
  btnTheme.onclick = () => {
    const isHidden = themePicker.classList.toggle('hidden');
    btnTheme.setAttribute('aria-expanded', isHidden ? 'false' : 'true');
  };
  document.querySelectorAll('.theme-swatch').forEach(btn => {
    btn.onclick = () => {
      applyColorTheme(btn.dataset.theme);
    };
  });

  // Modale des nouveautés (version actuelle)
  const changelogModal = document.getElementById('modal-changelog');
  const badgeNewVersion = document.getElementById('badge-new-version');
  if (localStorage.getItem('gardeticket_seen_version') !== APP_VERSION) {
    badgeNewVersion.classList.remove('hidden');
  }
  const openChangelog = () => {
    localStorage.setItem('gardeticket_seen_version', APP_VERSION);
    badgeNewVersion.classList.add('hidden');
    changelogModal.showModal();
  };
  document.getElementById('btn-changelog').onclick = openChangelog;
  document.getElementById('btn-version-footer').onclick = openChangelog;
  document.getElementById('btn-close-changelog').onclick = () => changelogModal.close();

  // Modale des futures fonctionnalités
  const roadmapModal = document.getElementById('modal-roadmap');
  document.getElementById('btn-roadmap').onclick = () => roadmapModal.showModal();
  document.getElementById('btn-close-roadmap').onclick = () => roadmapModal.close();

  const form = document.getElementById('ticket-form');

  document.getElementById('btn-toggle-form').onclick = () => {
    if (!form.classList.contains('hidden')) {
      form.classList.add('hidden');
      resetFormState();
    } else {
      resetFormState();
      form.classList.remove('hidden');
    }
  };

  document.getElementById('btn-cancel').onclick = () => {
    form.classList.add('hidden');
    resetFormState();
  };

  document.getElementById('photo-camera').onchange = handleFileSelect;
  document.getElementById('photo-file').onchange = handleFileSelect;

  document.getElementById('auto-crop').onchange = () => {
    document.getElementById('manual-crop-box').classList.add('hidden');
    refreshImagePreview();
  };

  document.getElementById('bw-filter').onchange = () => refreshImagePreview();

  document.getElementById('btn-manual-crop').onclick = () => {
    const box = document.getElementById('manual-crop-box');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) {
      document.getElementById('auto-crop').checked = false;
    }
    refreshImagePreview();
  };

  ['crop-top', 'crop-bottom', 'crop-left', 'crop-right'].forEach(id => {
    document.getElementById(id).oninput = () => refreshImagePreview();
  });

  document.getElementById('btn-rotate').onclick = () => {
    currentRotation = (currentRotation + 90) % 360;
    refreshImagePreview();
  };

  form.onsubmit = (e) => {
    e.preventDefault();
    if (!currentMediaData) {
      alert('Merci de prendre une photo ou de sélectionner une facture PDF.');
      return;
    }

    const ticket = {
      id: editingTicketId || Date.now().toString(),
      name: document.getElementById('name').value.trim(),
      store: document.getElementById('store').value.trim(),
      purchaseDate: document.getElementById('purchase-date').value,
      warrantyYears: document.getElementById('warranty-years').value,
      price: document.getElementById('price').value,
      notes: document.getElementById('notes').value.trim(),
      mediaType: currentMediaType,
      image: currentMediaData
    };

    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(ticket);
    tx.oncomplete = () => {
      form.classList.add('hidden');
      resetFormState();
      renderTickets();
    };
  };

  // Zoom plein écran (dialog au premier plan)
  const fsViewer = document.getElementById('fullscreen-viewer');
  const fsImg = document.getElementById('fs-img');

  document.getElementById('modal-img-wrap').onclick = () => {
    if (!currentTicket) return;
    fsImg.src = currentTicket.image;
    fsImg.classList.remove('zoomed');
    fsViewer.showModal();
  };

  fsImg.onclick = () => fsImg.classList.toggle('zoomed');
  document.getElementById('btn-close-fs').onclick = () => fsViewer.close();

  // Partage natif d'un ticket
  document.getElementById('btn-share').onclick = async () => {
    if (!currentTicket) return;
    const isPdf = currentTicket.mediaType === 'pdf' || currentTicket.image.startsWith('data:application/pdf');
    const ext = isPdf ? 'pdf' : 'jpg';
    const safeName = currentTicket.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'ticket';
    const file = dataURLtoFile(currentTicket.image, `${safeName}.${ext}`);
    const text = `${currentTicket.name}${currentTicket.store ? ' (' + currentTicket.store + ')' : ''} — Acheté le ${new Date(currentTicket.purchaseDate).toLocaleDateString('fr-BE')}`;

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ title: currentTicket.name, text, files: [file] });
      } catch (err) {
        if (err.name !== 'AbortError') alert('Impossible de partager ce fichier.');
      }
    } else {
      const a = document.createElement('a');
      a.href = currentTicket.image;
      a.download = `${safeName}.${ext}`;
      a.click();
    }
  };

  // Rappel dans l'agenda (.ics)
  document.getElementById('btn-reminder').onclick = () => {
    if (!currentTicket) return;
    downloadWarrantyReminder(currentTicket);
  };

  document.getElementById('btn-edit').onclick = () => {
    if (!currentTicket) return;
    document.getElementById('modal-ticket').close();

    editingTicketId = currentTicket.id;
    currentMediaData = currentTicket.image;
    currentMediaType = currentTicket.mediaType || (currentTicket.image.startsWith('data:application/pdf') ? 'pdf' : 'image');
    rawSelectedImage = currentMediaType === 'image' ? currentTicket.image : '';
    currentRotation = 0;
    resetManualSliders();

    document.getElementById('form-title').textContent = 'Modifier le ticket';
    document.getElementById('file-req').textContent = '(laisser vide pour conserver)';
    document.getElementById('name').value = currentTicket.name;
    document.getElementById('store').value = currentTicket.store || '';
    document.getElementById('purchase-date').value = currentTicket.purchaseDate;
    document.getElementById('warranty-years').value = currentTicket.warrantyYears;
    document.getElementById('price').value = currentTicket.price || '';
    document.getElementById('notes').value = currentTicket.notes || '';

    document.getElementById('manual-crop-box').classList.add('hidden');
    if (currentMediaType === 'pdf') {
      document.getElementById('crop-option').classList.add('hidden');
      document.getElementById('photo-preview').classList.add('hidden');
      document.getElementById('pdf-preview').classList.remove('hidden');
    } else {
      document.getElementById('auto-crop').checked = false;
      document.getElementById('bw-filter').checked = false;
      document.getElementById('crop-option').classList.remove('hidden');
      document.getElementById('pdf-preview').classList.add('hidden');
      const preview = document.getElementById('photo-preview');
      preview.src = currentMediaData;
      preview.classList.remove('hidden');
    }

    form.classList.remove('hidden');
    form.scrollIntoView({ behavior: 'smooth' });
  };

  document.getElementById('search').oninput = () => renderTickets();

  document.querySelectorAll('.filter-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      renderTickets();
    };
  });

  document.getElementById('expiry-alert-banner').onclick = () => {
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === 'warn');
    });
    currentFilter = 'warn';
    renderTickets();
  };

  document.getElementById('btn-close-modal').onclick = () => document.getElementById('modal-ticket').close();

  document.getElementById('btn-delete').onclick = () => {
    if (confirm('Supprimer définitivement ce ticket ?')) {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(currentTicket.id);
      tx.oncomplete = () => {
        document.getElementById('modal-ticket').close();
        renderTickets();
      };
    }
  };

  // 1. Sauvegarde locale directe dans le téléphone (.json)
  document.getElementById('btn-export').onclick = async () => {
    try {
      const tickets = await getAllTicketsAsync();
      const blob = new Blob([JSON.stringify(tickets)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gardeticket-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      alert('Erreur lors de la création de la sauvegarde.');
    }
  };

  // 2. Sauvegarde vers le cloud via le menu de partage système (.txt)
  document.getElementById('btn-export-cloud').onclick = async () => {
    try {
      const tickets = await getAllTicketsAsync();
      const jsonContent = JSON.stringify(tickets);
      const dateStr = new Date().toISOString().slice(0, 10);
      const shareFile = new File([jsonContent], `gardeticket-sauvegarde-${dateStr}.txt`, { type: 'text/plain' });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [shareFile] })) {
        try {
          await navigator.share({
            title: 'Sauvegarde GardeTicket',
            text: 'Sauvegarde de mes tickets et garanties GardeTicket',
            files: [shareFile]
          });
        } catch (err) {
          if (err && err.name !== 'AbortError') {
            alert('Impossible d’ouvrir le menu de partage.');
          }
        }
      } else {
        alert('Le partage vers le cloud n’est pas pris en charge par ce navigateur. Utilise le bouton « Sauvegarder » pour enregistrer le fichier sur ton téléphone.');
      }
    } catch (err) {
      alert('Erreur lors de la préparation de la sauvegarde.');
    }
  };

  // Import JSON / TXT sans doublons
  const importModal = document.getElementById('modal-import');
  document.getElementById('input-import').onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const items = JSON.parse(ev.target.result);
        if (!Array.isArray(items)) throw new Error('Format invalide');

        const tx = db.transaction(STORE_NAME, 'readonly');
        tx.objectStore(STORE_NAME).count().onsuccess = (cntEv) => {
          const existingCount = cntEv.target.result;
          if (existingCount === 0) {
            executeImport(items, true);
          } else {
            pendingImportItems = items;
            document.getElementById('import-summary').textContent =
              `Ce fichier contient ${items.length} ticket(s), et tu en as déjà ${existingCount} sur ton téléphone.`;
            importModal.showModal();
          }
        };
      } catch (err) {
        alert('Fichier de sauvegarde invalide.');
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  document.getElementById('btn-import-replace').onclick = () => {
    importModal.close();
    executeImport(pendingImportItems, true);
    pendingImportItems = [];
  };

  document.getElementById('btn-import-merge').onclick = () => {
    importModal.close();
    executeImport(pendingImportItems, false);
    pendingImportItems = [];
  };

  document.getElementById('btn-import-cancel').onclick = () => {
    importModal.close();
    pendingImportItems = [];
  };
});
