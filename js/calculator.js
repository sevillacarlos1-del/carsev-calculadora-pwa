/* ============================================================
 * CAR-SEV C.A. — Motor de cálculo estequiométrico y Controlador UI
 * v2.0 — Integra: Tapas Caladas, Lote Acumulado y Exportación
 * Todos los cálculos internos trabajan en gramos y cm³.
 * ============================================================ */
'use strict';

const Calculator = (() => {
  const SHORE_FLEX = 62, SHORE_RIGID = 84, DENSITY_MIN = 0.80, DENSITY_MAX = 1.60, WASTE_MIN = 0, WASTE_MAX = 15, LOSS_FACTOR = 1.005;

  const toGrams = (v, u) => u === 'kg' ? v * 1000 : v;
  const roundToGrams = (g) => Math.max(0, Math.round(g));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const num = (v, d = 1) => isFinite(v) ? v.toLocaleString('es', { minimumFractionDigits: d, maximumFractionDigits: d }) : '—';
  const fmtWeight = (g) => isFinite(g) ? (g >= 1000 ? { value: num(g / 1000, 2), unit: 'kg' } : { value: num(g, 0), unit: 'g' }) : { value: '—', unit: 'g' };

  function computeMix({ mode, totalWeight, totalUnit, pieces, pieceMass, ratioA, ratioB, wastePct }) {
    const a = Math.max(0, ratioA || 0), b = Math.max(0, ratioB || 0), sum = a + b;
    if (sum <= 0) return { valid: false, reason: 'La relación A:B no puede ser cero.' };
    let baseMass = mode === 'weight' ? toGrams(Math.max(0, totalWeight || 0), totalUnit) : Math.max(0, pieces || 0) * Math.max(0, pieceMass || 0);
    if (baseMass <= 0) return { valid: false, reason: 'Ingresa una masa o cantidad de piezas válida.' };
    const waste = clamp(wastePct || 0, WASTE_MIN, WASTE_MAX);
    const totalWithWaste = baseMass * (1 + waste / 100);
    return {
      valid: true, baseMass, wastePct: waste, wasteMass: totalWithWaste - baseMass, totalWithWaste,
      polyol: totalWithWaste * (a / sum), iso: totalWithWaste * (b / sum),
      polyolBatch: roundToGrams(totalWithWaste * (a / sum)), isoBatch: roundToGrams(totalWithWaste * (b / sum)),
      pctA: (a / sum) * 100, pctB: (b / sum) * 100
    };
  }

  function moldVolume({ shape, outerD, innerD, height, unit, directVolume, hasWindows = false, windowCount = 0, windowWidth = 0, windowArc = 0, windowThickness = 0 }) {
    let baseVolume;
    if (shape === 'direct') {
      const v = Math.max(0, directVolume || 0);
      if (v <= 0) return { valid: false, volume: 0, reason: 'Ingresa un volumen válido.' };
      baseVolume = v;
    } else {
      const f = unit === 'mm' ? 0.1 : 1;
      const DE = (outerD || 0) * f, DI = (innerD || 0) * f, H = (height || 0) * f;
      if (DE <= 0 || H <= 0) return { valid: false, volume: 0, reason: 'El diámetro exterior y la altura deben ser > 0.' };
      if (shape === 'annular' && (DI <= 0 || DI >= DE)) return { valid: false, volume: 0, reason: 'El Ø interior debe ser menor que el Ø exterior.' };
      baseVolume = shape === 'annular' ? (Math.PI / 4) * (DE * DE - DI * DI) * H : (Math.PI / 4) * DE * DE * H;
    }
    let windowVolume = 0;
    if (hasWindows && windowCount > 0) {
      windowVolume = (windowCount * Math.max(0, windowWidth || 0) * Math.max(0, windowArc || 0) * Math.max(0, windowThickness || 0)) / 1000;
    }
    if (windowVolume >= baseVolume) {
      return { valid: false, volume: baseVolume, windowVolume, reason: `El volumen de los huecos (${num(windowVolume, 1)} cm³) supera el volumen base del molde (${num(baseVolume, 1)} cm³).` };
    }
    return { valid: true, volume: baseVolume, windowVolume, netVolume: baseVolume - windowVolume, hasWindows, windowCount };
  }

  function massFromVolume(volumeCm3, density, applyLoss = false) {
    return Math.max(0, volumeCm3 || 0) * clamp(density || 0, DENSITY_MIN, DENSITY_MAX) * (applyLoss ? LOSS_FACTOR : 1);
  }

  function computeWindowBreakdown(netVolumeCm3, density, ratioA, ratioB, wastePct) {
    const a = Math.max(0, ratioA || 0), b = Math.max(0, ratioB || 0), sum = a + b;
    if (sum <= 0) return { valid: false, reason: 'Relación A:B inválida.' };
    const massG = massFromVolume(netVolumeCm3, density, true);
    const totalG = massG * (1 + clamp(wastePct || 0, WASTE_MIN, WASTE_MAX) / 100);
    return { valid: true, mass: massG, polyol: totalG * (a / sum), iso: totalG * (b / sum), total: totalG };
  }

  const Batch = (() => {
    let _items = [], _seq = 0;
    const _id = () => `item_${++_seq}_${Date.now()}`;
    const add = (payload) => {
      _items.push({ id: _id(), name: payload.name || 'Tapa', type: payload.type || 'plain', windowCount: payload.windowCount || 0, qty: Math.max(1, Math.round(payload.qty || 0)), polyol: Math.max(0, payload.polyol || 0), iso: Math.max(0, payload.iso || 0), createdAt: Date.now() });
      return _items;
    };
    const remove = (id) => { _items = _items.filter(i => i.id !== id); return _items; };
    const clear = () => { _items = []; return _items; };
    const list = () => [..._items];
    const summary = () => _items.reduce((acc, it) => { acc.polyol += it.polyol * it.qty; acc.iso += it.iso * it.qty; acc.qty += it.qty; return acc; }, { polyol: 0, iso: 0, qty: 0, get total() { return this.polyol + this.iso; } });
    const persist = () => { try { localStorage.setItem('carsev_batch', JSON.stringify({ seq: _seq, items: _items })); } catch(_) {} };
    const restore = () => { try { const raw = JSON.parse(localStorage.getItem('carsev_batch') || '{}'); if (raw && Array.isArray(raw.items)) { _items = raw.items; _seq = raw.seq || _items.length; } } catch {} };
    restore();
    return { add, remove, clear, list, summary, persist };
  })();

  const additives = (polyolGrams, { pigmentPct, catalystPct, releasePct }) => {
    const base = Math.max(0, polyolGrams || 0);
    return { pigment: base * (pigmentPct || 0) / 100, catalyst: base * (catalystPct || 0) / 100, release: base * (releasePct || 0) / 100 };
  };
  const shoreEstimate = (flexPct) => SHORE_FLEX + (SHORE_RIGID - SHORE_FLEX) * (clamp(100 - flexPct, 0, 100) / 100);
  const costPerKg = (pctA, pctB, pP, iP) => (pctA / 100) * (pP || 0) + (pctB / 100) * (iP || 0);
  const costBatch = (g, ckg) => (Math.max(0, g || 0) / 1000) * (ckg || 0);
  const costPerPiece = (g, ckg) => (Math.max(0, g || 0) / 1000) * (ckg || 0);

  return { SHORE_FLEX, SHORE_RIGID, DENSITY_MIN, DENSITY_MAX, WASTE_MIN, WASTE_MAX, LOSS_FACTOR, toGrams, roundToGrams, num, clamp, fmtWeight, computeMix, moldVolume, massFromVolume, computeWindowBreakdown, additives, shoreEstimate, costPerKg, costBatch, costPerPiece, Batch };
})();

document.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined') lucide.createIcons();
  const $ = (id) => document.getElementById(id);
  const val = (id) => parseFloat($(id)?.value) || 0;
  const str = (id) => $(id)?.value?.trim() || '';
  
  const toast = (msg, type = 'info') => {
    const zone = $('toastZone');
    const el = document.createElement('div');
    const colors = type === 'success' ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-400' : type === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-400' : 'border-cyan-500/40 bg-cyan-500/10 text-cyan-400';
    el.className = `toast flex items-center gap-2 px-4 py-3 rounded-xl border ${colors} text-sm font-medium shadow-lg backdrop-blur`;
    el.innerHTML = `<i data-lucide="${type === 'success' ? 'check-circle' : type === 'error' ? 'triangle-alert' : 'info'}" class="w-4 h-4"></i> ${msg}`;
    zone.appendChild(el);
    if (typeof lucide !== 'undefined') lucide.createIcons();
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
  };

  const showPanel = (panelId) => {
    document.querySelectorAll('section[id^="panel-"]').forEach(s => s.classList.add('hidden'));
    $(`panel-${panelId}`)?.classList.remove('hidden');
    document.querySelectorAll('.nav-btn, .nav-btn-m').forEach(btn => {
      btn.classList.toggle('nav-active', btn.dataset.panel === panelId);
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };
  document.querySelectorAll('[data-panel]').forEach(btn => btn.addEventListener('click', () => showPanel(btn.dataset.panel)));

  const updateMix = () => {
    const mode = document.querySelector('input[name="dosMode"]:checked')?.value || 'weight';
    $('weightModeBox').classList.toggle('hidden', mode !== 'weight');
    $('piecesModeBox').classList.toggle('hidden', mode !== 'pieces');
    const mix = Calculator.computeMix({ mode, totalWeight: val('inTotalWeight'), totalUnit: $('selTotalUnit')?.value || 'g', pieces: val('inPieces'), pieceMass: val('inPieceMass'), ratioA: val('inRatioA'), ratioB: val('inRatioB'), wastePct: val('inWaste') });
    if (!mix.valid) { $('outPolyol').textContent = '—'; $('outIso').textContent = '—'; $('outTotal').textContent = '—'; return; }
    $('outWasteVal').textContent = Calculator.num(mix.wastePct, 1);
    $('outPctA').textContent = Calculator.num(mix.pctA, 1); $('outPctB').textContent = Calculator.num(mix.pctB, 1);
    $('outRatioLabel').textContent = `${val('inRatioA')} : ${val('inRatioB')}`;
    $('mixBarA').style.width = `${mix.pctA}%`; $('mixBarB').style.width = `${mix.pctB}%`;
    $('outPolyol').textContent = Calculator.num(mix.polyol, 1); $('outIso').textContent = Calculator.num(mix.iso, 1); $('outTotal').textContent = Calculator.num(mix.totalWithWaste, 1);
    $('outPolyolKg').textContent = Calculator.num(mix.polyol / 1000, 3); $('outIsoKg').textContent = Calculator.num(mix.iso / 1000, 3);
    $('outPolyolBatch').textContent = mix.polyolBatch; $('outIsoBatch').textContent = mix.isoBatch;
    $('outBase').textContent = Calculator.num(mix.baseMass, 1); $('outWasteG').textContent = Calculator.num(mix.wasteMass, 1);
    updateAdditives(); updateCosts();
  };

  ['inTotalWeight', 'inPieces', 'inPieceMass', 'inRatioA', 'inRatioB', 'inWaste'].forEach(id => $(id)?.addEventListener('input', updateMix));
  $('selTotalUnit')?.addEventListener('change', updateMix);
  document.querySelectorAll('input[name="dosMode"]').forEach(r => r.addEventListener('change', updateMix));
  document.querySelectorAll('.ratio-chip').forEach(btn => {
    btn.addEventListener('click', () => {
      $('inRatioA').value = btn.dataset.a; $('inRatioB').value = btn.dataset.b;
      $('customRatioBox').classList.add('hidden');
      document.querySelectorAll('.ratio-chip').forEach(b => b.classList.remove('ratio-active'));
      btn.classList.add('ratio-active'); updateMix();
    });
  });
  $('btnRatioCustom')?.addEventListener('click', () => { $('customRatioBox').classList.toggle('hidden'); updateMix(); });
  $('inRatioA')?.addEventListener('input', () => { document.querySelectorAll('.ratio-chip').forEach(b => b.classList.remove('ratio-active')); updateMix(); });
  $('inRatioB')?.addEventListener('input', () => { document.querySelectorAll('.ratio-chip').forEach(b => b.classList.remove('ratio-active')); updateMix(); });

  const updateMold = () => {
    const shape = document.querySelector('input[name="moldShape"]:checked')?.value || 'annular';
    $('dimsBox').classList.toggle('hidden', shape === 'direct');
    $('directBox').classList.toggle('hidden', shape !== 'direct');
    $('inInnerDWrap').classList.toggle('hidden', shape !== 'annular');
    const capType = document.querySelector('input[name="capType"]:checked')?.value || 'plain';
    $('windowsBox').classList.toggle('hidden', capType !== 'windowed');
    const result = Calculator.moldVolume({ shape, outerD: val('inOuterD'), innerD: val('inInnerD'), height: val('inHeight'), unit: $('selDimUnit')?.value || 'mm', directVolume: val('inDirectVol'), hasWindows: capType === 'windowed', windowCount: val('selWindows'), windowWidth: val('inWinWidth'), windowArc: val('inWinArc'), windowThickness: val('inWinThick') });
    if (!result.valid) {
      $('moldWarning').textContent = result.reason; $('moldWarning').classList.remove('hidden');
      $('outVolume').textContent = '—'; $('outPieceMass').textContent = '—'; return;
    }
    $('moldWarning').classList.add('hidden');
    const displayVol = result.hasWindows ? result.netVolume : result.volume;
    const mass = Calculator.massFromVolume(displayVol, val('inDensity'), result.hasWindows);
    $('outVolume').textContent = Calculator.num(displayVol, 1); $('outPieceMass').textContent = Calculator.num(mass, 1);
    if (result.hasWindows) {
      const pct = (result.windowVolume / result.volume) * 100;
      $('outWinVol').textContent = Calculator.num(result.windowVolume, 2); $('outWinPct').textContent = Calculator.num(pct, 1) + '%';
    }
  };

  ['inOuterD', 'inInnerD', 'inHeight', 'inDirectVol', 'inDensity', 'inWinWidth', 'inWinArc', 'inWinThick'].forEach(id => $(id)?.addEventListener('input', updateMold));
  $('selDimUnit')?.addEventListener('change', updateMold); $('selWindows')?.addEventListener('change', updateMold);
  document.querySelectorAll('input[name="moldShape"]').forEach(r => r.addEventListener('change', updateMold));
  document.querySelectorAll('input[name="capType"]').forEach(r => r.addEventListener('change', updateMold));

  $('btnUseMoldMass')?.addEventListener('click', () => {
    const mass = parseFloat($('outPieceMass').textContent.replace(',', '.'));
    if (isFinite(mass) && mass > 0) {
      $('inPieceMass').value = mass.toFixed(1);
      document.querySelector('input[name="dosMode"][value="pieces"]').checked = true;
      showPanel('dosificacion'); updateMix(); toast('Masa del molde aplicada a la dosificación', 'success');
    }
  });

  $('btnAddBatch')?.addEventListener('click', () => {
    const mass = parseFloat($('outPieceMass').textContent.replace(',', '.'));
    if (!isFinite(mass) || mass <= 0) return toast('Calcula primero la masa del molde', 'error');
    const capType = document.querySelector('input[name="capType"]:checked')?.value || 'plain';
    const result = Calculator.moldVolume({ shape: document.querySelector('input[name="moldShape"]:checked')?.value || 'annular', outerD: val('inOuterD'), innerD: val('inInnerD'), height: val('inHeight'), unit: $('selDimUnit')?.value || 'mm', directVolume: val('inDirectVol'), hasWindows: capType === 'windowed', windowCount: val('selWindows'), windowWidth: val('inWinWidth'), windowArc: val('inWinArc'), windowThickness: val('inWinThick') });
    if (!result.valid) return toast(result.reason, 'error');
    const qtyStr = prompt('¿Cuántas unidades de esta tapa se van a producir?', '10');
    const qty = parseInt(qtyStr, 10);
    if (!qty || qty <= 0) return toast('Cantidad inválida', 'error');
    const vol = result.hasWindows ? result.netVolume : result.volume;
    const breakdown = Calculator.computeWindowBreakdown(vol, val('inDensity'), val('inRatioA'), val('inRatioB'), val('inWaste'));
    const name = str('inBatchName') || `Tapa-${Date.now().toString().slice(-4)}`;
    Calculator.Batch.add({ name, type: capType, windowCount: val('selWindows'), qty, polyol: breakdown.polyol, iso: breakdown.iso });
    Calculator.Batch.persist(); renderBatch(); toast(`Agregadas ${qty} uds. de "${name}" al lote`, 'success');
  });

  const updateAdditives = () => {
    const polyolG = parseFloat($('outPolyol')?.textContent.replace(',', '.') || '0') || 0;
    $('additiveContext').textContent = `Base: ${Calculator.num(polyolG, 1)} g de Poliol A`;
    const adds = Calculator.additives(polyolG, { pigmentPct: val('inPigment'), catalystPct: val('inCatalyst'), releasePct: val('inRelease') });
    $('outPigmentPct').textContent = Calculator.num(val('inPigment'), 1); $('outPigment').textContent = Calculator.num(adds.pigment, 1);
    $('outCatalystPct').textContent = Calculator.num(val('inCatalyst'), 1); $('outCatalyst').textContent = Calculator.num(adds.catalyst, 1);
    $('outReleasePct').textContent = Calculator.num(val('inRelease'), 1); $('outRelease').textContent = Calculator.num(adds.release, 1);
  };
  ['inPigment', 'inCatalyst', 'inRelease'].forEach(id => $(id)?.addEventListener('input', updateAdditives));

  const updateCosts = () => {
    const totalG = parseFloat($('outTotal')?.textContent.replace(',', '.') || '0') || 0;
    const pieceG = parseFloat($('outPieceMass')?.textContent.replace(',', '.') || '0') || 0;
    const pctA = parseFloat($('outPctA')?.textContent.replace(',', '.')) || 50;
    const pctB = parseFloat($('outPctB')?.textContent.replace(',', '.')) || 50;
    const costKg = Calculator.costPerKg(pctA, pctB, val('inPolyolPrice'), val('inIsoPrice'));
    $('outCostKg').textContent = Calculator.num(costKg, 2);
    if (pieceG > 0) { $('costPieceBox').classList.remove('hidden'); $('outCostPiece').textContent = Calculator.num(Calculator.costPerPiece(pieceG, costKg), 4); }
    if (totalG > 0) { $('costBatchBox').classList.remove('hidden'); $('outCostBatch').textContent = Calculator.num(Calculator.costBatch(totalG, costKg), 2); }
  };
  ['inPolyolPrice', 'inIsoPrice'].forEach(id => $(id)?.addEventListener('input', updateCosts));

  const renderBatch = () => {
    const items = Calculator.Batch.list();
    const tpl = $('batchRowTpl');
    const list = $('batchList');
    const empty = $('batchEmpty');
    list.innerHTML = '';
    empty.classList.toggle('hidden', items.length > 0);
    list.classList.toggle('hidden', items.length === 0);
    items.forEach(it => {
      const row = tpl.content.firstElementChild.cloneNode(true);
      row.dataset.id = it.id;
      const typeLabel = it.type === 'windowed' ? `${it.windowCount} ventanas` : 'Lisa';
      row.querySelector('[data-f="title"]').textContent = `${it.qty}× ${it.name}`;
      row.querySelector('[data-f="detail"]').textContent = `Config: Tapa ${typeLabel}`;
      row.querySelector('[data-f="polyol"]').textContent = Calculator.num(it.polyol * it.qty, 0) + ' g';
      row.querySelector('[data-f="iso"]').textContent = Calculator.num(it.iso * it.qty, 0) + ' g';
      row.querySelector('[data-act="del"]').addEventListener('click', () => {
        Calculator.Batch.remove(it.id); Calculator.Batch.persist(); renderBatch(); toast('Ítem eliminado del lote', 'info');
      });
      list.appendChild(row);
    });
    if (typeof lucide !== 'undefined') lucide.createIcons();
    const s = Calculator.Batch.summary();
    const fmtP = Calculator.fmtWeight(s.polyol), fmtI = Calculator.fmtWeight(s.iso), fmtM = Calculator.fmtWeight(s.total);
    $('batchTotalPolyol').textContent = fmtP.value; $('batchTotalPolyolUnit').textContent = fmtP.unit;
    $('batchTotalIso').textContent = fmtI.value; $('batchTotalIsoUnit').textContent = fmtI.unit;
    $('batchTotalMix').textContent = fmtM.value; $('batchTotalMixUnit').textContent = fmtM.unit;
    $('batchTotalQty').textContent = s.qty; $('batchCount').textContent = items.length;
  };

  $('btnClearBatch')?.addEventListener('click', () => {
    if (confirm('¿Estás seguro de vaciar todo el lote acumulado? Esta acción no se puede deshacer.')) {
      Calculator.Batch.clear(); Calculator.Batch.persist(); renderBatch(); toast('Lote vaciado completamente', 'info');
    }
  });

  $('btnExportCSV')?.addEventListener('click', () => {
    const items = Calculator.Batch.list();
    if (!items.length) return toast('El lote está vacío', 'error');
    let csv = 'Nombre,Tipo,Huecos,Cantidad,Poliol(g),Isocianato(g),Total_Mezcla(g)\n';
    items.forEach(it => {
      const tipo = it.type === 'windowed' ? 'Con Ventanas' : 'Lisa';
      csv += `"${it.name}","${tipo}",${it.windowCount},${it.qty},${it.polyol.toFixed(2)},${it.iso.toFixed(2)},${(it.polyol + it.iso).toFixed(2)}\n`;
    });
    const s = Calculator.Batch.summary();
    csv += `\n"RESUMEN GLOBAL","","",${s.qty},${s.polyol.toFixed(2)},${s.iso.toFixed(2)},${s.total.toFixed(2)}\n`;
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `Lote_CAR-SEV_${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url); toast('Lote exportado a CSV exitosamente', 'success');
  });

  $('btnExportPDF')?.addEventListener('click', () => {
    const items = Calculator.Batch.list();
    if (!items.length) return toast('El lote está vacío', 'error');
    if (typeof window.jspdf === 'undefined') return toast('Librería PDF cargando... Intenta de nuevo en 2 segundos.', 'warning');
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    doc.setFontSize(18); doc.setTextColor(8, 145, 178); doc.text('ORDEN DE PRODUCCIÓN', 14, 20);
    doc.setFontSize(11); doc.setTextColor(100, 116, 139);
    doc.text('CAR-SEV C.A. — Dosificación de Poliuretano', 14, 28);
    doc.text(`Fecha de emisión: ${new Date().toLocaleString('es-VE')}`, 14, 34);
    const tableData = items.map(it => [it.name, it.type === 'windowed' ? `Ventanas (${it.windowCount})` : 'Lisa', it.qty, it.polyol.toFixed(1) + ' g', it.iso.toFixed(1) + ' g', (it.polyol + it.iso).toFixed(1) + ' g']);
    const s = Calculator.Batch.summary();
    tableData.push(['', '', '', '', '', '']);
    tableData.push(['TOTALES DEL LOTE', '', s.qty, Calculator.fmtWeight(s.polyol).value + ' ' + Calculator.fmtWeight(s.polyol).unit, Calculator.fmtWeight(s.iso).value + ' ' + Calculator.fmtWeight(s.iso).unit, Calculator.fmtWeight(s.total).value + ' ' + Calculator.fmtWeight(s.total).unit]);
    doc.autoTable({
      startY: 40, head: [['Modelo / Código', 'Geometría', 'Cant.', 'Poliol (A)', 'Isocianato (B)', 'Total Mezcla']], body: tableData, theme: 'grid',
      headStyles: { fillColor: [8, 145, 178], textColor: 255, fontStyle: 'bold' }, footStyles: { fillColor: [30, 41, 59], textColor: 255, fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 3 }, columnStyles: { 0: { cellWidth: 50 }, 2: { halign: 'center' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } }
    });
    const finalY = doc.lastAutoTable.finalY + 15;
    doc.setFontSize(9); doc.setTextColor(150);
    doc.text('Nota: Verificar la relación de mezcla y la densidad antes de la colada. Usar EPP completo.', 14, finalY);
    doc.save(`Orden_Lote_CAR-SEV_${new Date().toISOString().slice(0, 10)}.pdf`);
    toast('Orden de producción exportada a PDF', 'success');
  });

  updateMix(); updateMold(); renderBatch();

  let deferredPrompt;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); deferredPrompt = e;
    $('installBtnTop')?.classList.remove('hidden'); $('installBtnTop')?.classList.add('flex');
    $('installFab')?.classList.remove('hidden'); $('installFab')?.classList.add('flex');
  });
  const installApp = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') { $('installBtnTop')?.classList.add('hidden'); $('installFab')?.classList.add('hidden'); }
    deferredPrompt = null;
  };
  $('installBtnTop')?.addEventListener('click', installApp);
  $('installFab')?.addEventListener('click', installApp);

  $('btnCopyMix')?.addEventListener('click', () => {
    const txt = `CAR-SEV C.A. - Dosificación\nA (Poliol): ${$('outPolyol').textContent} g\nB (Iso): ${$('outIso').textContent} g\nTotal: ${$('outTotal').textContent} g`;
    navigator.clipboard.writeText(txt).then(() => toast('Reporte copiado al portapapeles', 'success'));
  });
});