/* ============================================================
 * CAR-SEV C.A. — Controlador de interfaz y ciclo de vida PWA
 * Depende de: Calculator (js/calculator.js), Storage (js/storage.js)
 * ============================================================ */

'use strict';

(() => {

  const $ = (id) => document.getElementById(id);

  /* ============================================================
   * ESTADO CENTRAL DE LA APLICACIÓN
   * ============================================================ */
  const state = {
    dosMode: 'weight',          // 'weight' | 'pieces'
    moldShape: 'annular',       // 'annular' | 'cylinder' | 'direct'
    activeRatio: { a: 100, b: 50, custom: false },
    lastMix: null,              // resultado del motor de cálculo
    lastMold: null,             // { volume, pieceMass }
    deferredPrompt: null,       // evento de instalación PWA
  };

  /* Referencias rápidas a resultados (cache de DOM) */
  const el = {};

  /* ============================================================
   * TOASTS (feedback no bloqueante)
   * ============================================================ */
  function toast(message, type = 'info') {
    const zone = $('toastZone');
    const colors = {
      info:    'border-cyan-500/40 text-cyan-300',
      success: 'border-emerald-500/40 text-emerald-300',
      error:   'border-red-500/40 text-red-300',
    };
    const icons = { info: 'info', success: 'check', error: 'triangle-alert' };
    const node = document.createElement('div');
    node.className = `toast flex items-center gap-2.5 bg-slate-900/95 backdrop-blur border ${colors[type]} rounded-xl px-4 py-3 text-sm shadow-lg`;
    node.innerHTML = `<i data-lucide="${icons[type] || 'info'}" class="w-4 h-4 shrink-0"></i><span class="text-slate-200">${message}</span>`;
    zone.appendChild(node);
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
    setTimeout(() => {
      node.style.transition = 'opacity .3s, transform .3s';
      node.style.opacity = '0';
      node.style.transform = 'translateY(8px)';
      setTimeout(() => node.remove(), 320);
    }, 3400);
  }

  /* ============================================================
   * NAVEGACIÓN ENTRE MÓDULOS (con soporte de hash)
   * ============================================================ */
  const PANELS = ['dosificacion', 'cubaje', 'aditivos', 'recetas'];

  function showPanel(name) {
    if (!PANELS.includes(name)) name = 'dosificacion';
    PANELS.forEach((p) => {
      const section = $('panel-' + p);
      if (section) section.classList.toggle('hidden', p !== name);
    });
    document.querySelectorAll('[data-panel]').forEach((btn) => {
      const isActive = btn.dataset.panel === name;
      btn.classList.toggle('nav-active', isActive && !btn.classList.contains('nav-btn-m'));
      btn.classList.toggle('text-cyan-400', isActive && btn.classList.contains('nav-btn-m'));
      btn.classList.toggle('text-slate-500', !isActive);
    });
    if (location.hash !== '#' + name) {
      history.replaceState(null, '', '#' + name);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /* ============================================================
   * PINTADO DE SLIDERS (relleno de progreso)
   * ============================================================ */
  function paintRange(input, color = '#22d3ee') {
    const min = parseFloat(input.min);
    const max = parseFloat(input.max);
    const val = parseFloat(input.value);
    const pct = ((val - min) / (max - min)) * 100;
    input.style.background = `linear-gradient(to right, ${color} ${pct}%, #1e293b ${pct}%)`;
  }

  /* ============================================================
   * MÓDULO A — DOSIFICACIÓN
   * ============================================================ */
  function setDosMode(mode) {
    state.dosMode = mode;
    $('weightModeBox').classList.toggle('hidden', mode !== 'weight');
    $('piecesModeBox').classList.toggle('hidden', mode !== 'pieces');
    recalcAll();
  }

  function setActiveRatio(a, b, custom) {
    state.activeRatio = { a, b, custom };
    $('inRatioA').value = a;
    $('inRatioB').value = b;
    $('customRatioBox').classList.toggle('hidden', !custom);
    document.querySelectorAll('.ratio-chip').forEach((chip) => {
      const match = !custom && parseFloat(chip.dataset.a) === a && parseFloat(chip.dataset.b) === b;
      chip.classList.toggle('ratio-active', match);
      chip.setAttribute('aria-pressed', match ? 'true' : 'false');
    });
    $('btnRatioCustom').classList.toggle('ratio-active', !!custom);
    recalcAll();
  }

  function readInputs() {
    return {
      mode: state.dosMode,
      totalWeight: parseFloat($('inTotalWeight').value) || 0,
      totalUnit: $('selTotalUnit').value,
      pieces: parseFloat($('inPieces').value) || 0,
      pieceMass: parseFloat($('inPieceMass').value) || 0,
      ratioA: parseFloat($('inRatioA').value) || 0,
      ratioB: parseFloat($('inRatioB').value) || 0,
      wastePct: parseFloat($('inWaste').value) || 0,
    };
  }

  function recalcMix() {
    const inputs = readInputs();
    const out = $('outWasteVal');
    out.textContent = Calculator.num(inputs.wastePct, 1);
    paintRange($('inWaste'), '#22d3ee');

    const mix = Calculator.computeMix(inputs);
    state.lastMix = mix;

    if (!mix.valid) {
      ['outPolyol', 'outIso', 'outTotal'].forEach((id) => ($(id).textContent = '—'));
      ['outPolyolKg', 'outIsoKg', 'outTotalKg'].forEach((id) => ($(id).textContent = '—'));
      ['outPolyolBatch', 'outIsoBatch', 'outBase', 'outWasteG'].forEach((id) => ($(id).textContent = '—'));
      $('mixBarA').style.width = '50%';
      $('mixBarB').style.width = '50%';
      return;
    }

    // Tarjetas principales
    $('outPolyol').textContent = Calculator.num(mix.polyol, 1);
    $('outIso').textContent    = Calculator.num(mix.iso, 1);
    $('outTotal').textContent  = Calculator.num(mix.totalWithWaste, 1);

    $('outPolyolKg').textContent = Calculator.num(mix.polyol / 1000, 3);
    $('outIsoKg').textContent    = Calculator.num(mix.iso / 1000, 3);
    $('outTotalKg').textContent  = Calculator.num(mix.totalWithWaste / 1000, 3);

    // Pesos a bascular (gramos enteros, valor operativo de planta)
    $('outPolyolBatch').textContent = mix.polyolBatch.toLocaleString('es');
    $('outIsoBatch').textContent    = mix.isoBatch.toLocaleString('es');

    // Desglose base + merma
    $('outBase').textContent   = Calculator.num(mix.baseMass, 1);
    $('outWasteG').textContent = Calculator.num(mix.wasteMass, 1);

    // Barra proporcional en vivo
    $('mixBarA').style.width = mix.pctA.toFixed(1) + '%';
    $('mixBarB').style.width = mix.pctB.toFixed(1) + '%';
    $('outPctA').textContent = mix.pctA.toFixed(1);
    $('outPctB').textContent = mix.pctB.toFixed(1);
    $('outRatioLabel').textContent =
      `${inputs.ratioA} : ${inputs.ratioB}`;

    recalcAdditives();
    recalcCosts();
  }

  /* ============================================================
   * MÓDULO B — CUBAJE Y PLANO DEL MOLDE
   * ============================================================ */
  function recalcMold() {
    const shape = state.moldShape;
    const inputs = {
      shape,
      outerD: parseFloat($('inOuterD').value) || 0,
      innerD: parseFloat($('inInnerD').value) || 0,
      height: parseFloat($('inHeight').value) || 0,
      unit: $('selDimUnit').value,
      directVolume: parseFloat($('inDirectVol').value) || 0,
    };
    const density = parseFloat($('inDensity').value) || 1.15;

    $('outDensityVal').textContent = density.toFixed(2);
    paintRange($('inDensity'), '#22d3ee');

    const result = Calculator.moldVolume(inputs);
    const warn = $('moldWarning');

    if (!result.valid) {
      $('outVolume').textContent = '—';
      $('outPieceMass').textContent = '—';
      state.lastMold = null;
      warn.textContent = result.reason;
      warn.classList.remove('hidden');
      renderMoldSVG(null);
      updateUseMassButtons();
      return;
    }

    warn.classList.add('hidden');
    const mass = Calculator.massFromVolume(result.volume, density);
    state.lastMold = { volume: result.volume, pieceMass: mass, unit: inputs.unit, ...inputs };

    $('outVolume').textContent    = Calculator.num(result.volume, 1);
    $('outPieceMass').textContent = Calculator.num(mass, 1);

    renderMoldSVG(state.lastMold);
    updateUseMassButtons();
  }

  function updateUseMassButtons() {
    const hasMass = state.lastMold && state.lastMold.pieceMass > 0;
    const btnUse = $('btnUseMass');
    const btnMold = $('btnUseMoldMass');
    btnUse.disabled = !hasMass;
    btnUse.classList.toggle('opacity-40', !hasMass);
    btnUse.classList.toggle('cursor-not-allowed', !hasMass);
    btnMold.classList.toggle('hidden', !hasMass);
    btnMold.classList.toggle('inline-flex', hasMass);
  }

  /* ---------- Plano técnico SVG dinámico ---------- */
  function renderMoldSVG(mold) {
    const svg = $('moldSVG');

    if (!mold) {
      svg.innerHTML = `
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
            <path d="M0 0L10 5L0 10z" fill="#64748b"/>
          </marker>
        </defs>
        <text x="170" y="95" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" fill="#475569">
          Ingresa dimensiones válidas para dibujar el plano
        </text>`;
      return;
    }

    const { shape, outerD, innerD, height, unit } = mold;
    // Escala: diámetro ≤ 118 px, altura ≤ 66 px dentro del lienzo 340×190
    const k = Math.min(118 / outerD, 66 / height);
    const deW = outerD * k;
    const hH  = height * k;
    const diW = shape === 'annular' ? innerD * k : 0;

    const CX = 78;          // centro de la vista superior
    const CY = 88;
    const FX = 178;         // x de la vista frontal
    const FY = CY - hH / 2; // y de la vista frontal
    const rExt = deW / 2;
    const rInt = diW / 2;
    const uLabel = ` ${unit}`;

    const dimStroke = 'stroke="#64748b" stroke-width="1" marker-start="url(#arr)" marker-end="url(#arr)"';
    const label = (x, y, text, anchor = 'middle', fill = '#94a3b8') =>
      `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="IBM Plex Mono, monospace" font-size="10" fill="${fill}">${text}</text>`;

    let top = '';
    let front = '';

    // ===== Vista superior =====
    if (shape === 'annular') {
      top += `<path d="M ${CX - rExt} ${CY}
                a ${rExt} ${rExt} 0 1 0 ${rExt * 2} 0
                a ${rExt} ${rExt} 0 1 0 ${-rExt * 2} 0 z
                M ${CX - rInt} ${CY}
                a ${rInt} ${rInt} 0 1 0 ${rInt * 2} 0
                a ${rInt} ${rInt} 0 1 0 ${-rInt * 2} 0 z"
              fill="rgba(34,211,238,0.07)" fill-rule="evenodd"
              stroke="#22d3ee" stroke-width="1.5"/>`;
      // Cota Ø interior: flechas hacia afuera desde el centro
      top += `<line x1="${CX - rInt}" y1="${CY}" x2="${CX + rInt}" y2="${CY}" ${dimStroke}/>`;
      top += label(CX, CY - 5, `Ø${innerD}`);
    } else {
      top += `<circle cx="${CX}" cy="${CY}" r="${rExt}" fill="rgba(34,211,238,0.07)" stroke="#22d3ee" stroke-width="1.5"/>
              <line x1="${CX - rExt}" y1="${CY}" x2="${CX + rExt}" y2="${CY}" stroke="#0e7490" stroke-width="1" stroke-dasharray="4 3"/>`;
    }
    // Cota Ø exterior (debajo de la vista superior)
    const dimY = CY + rExt + 20;
    top += `<line x1="${CX - rExt}" y1="${dimY}" x2="${CX + rExt}" y2="${dimY}" ${dimStroke}/>`;
    top += `<line x1="${CX - rExt}" y1="${CY + rExt + 3}" x2="${CX - rExt}" y2="${dimY + 4}" stroke="#334155" stroke-width="1"/>`;
    top += `<line x1="${CX + rExt}" y1="${CY + rExt + 3}" x2="${CX + rExt}" y2="${dimY + 4}" stroke="#334155" stroke-width="1"/>`;
    top += label(CX, dimY + 14, `Ø${outerD}${uLabel}`);
    top += label(CX, 18, 'SUPERIOR', 'middle', '#475569');

    // ===== Vista frontal (sección) =====
    front += `<rect x="${FX}" y="${FY}" width="${deW}" height="${hH}" rx="2"
               fill="rgba(148,163,184,0.08)" stroke="#22d3ee" stroke-width="1.5"/>`;
    if (shape === 'annular') {
      const gap = (deW - diW) / 2;
      front += `<line x1="${FX + gap}" y1="${FY}" x2="${FX + gap}" y2="${FY + hH}" stroke="#0e7490" stroke-width="1" stroke-dasharray="4 3"/>
                <line x1="${FX + gap + diW}" y1="${FY}" x2="${FX + gap + diW}" y2="${FY + hH}" stroke="#0e7490" stroke-width="1" stroke-dasharray="4 3"/>`;
    }
    // Cota de altura H
    const hx = FX + deW + 18;
    front += `<line x1="${hx}" y1="${FY}" x2="${hx}" y2="${FY + hH}" ${dimStroke}/>`;
    front += `<line x1="${FX + deW + 3}" y1="${FY}" x2="${hx + 4}" y2="${FY}" stroke="#334155" stroke-width="1"/>`;
    front += `<line x1="${FX + deW + 3}" y1="${FY + hH}" x2="${hx + 4}" y2="${FY + hH}" stroke="#334155" stroke-width="1"/>`;
    front += label(hx + 8, FY + hH / 2 + 4, `H${height}`, 'start');
    front += label(FX + deW / 2, 18, 'SECCIÓN', 'middle', '#475569');

    svg.innerHTML = `
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#64748b"/>
        </marker>
      </defs>
      ${top}
      ${front}`;
  }

  /* ============================================================
   * MÓDULO C — ADITIVOS Y SHORE A
   * ============================================================ */
  function recalcAdditives() {
    const flexPct = parseFloat($('inFlex').value) || 0;
    $('outFlexVal').textContent  = Math.round(flexPct);
    $('outRigidVal').textContent = Math.round(100 - flexPct);
    paintRange($('inFlex'), '#f59e0b');

    // Dureza estimada (referencial)
    $('outShore').textContent = Calculator.num(Calculator.shoreEstimate(flexPct), 1);

    // Masa de poliol disponible
    const polyolG = state.lastMix && state.lastMix.valid ? state.lastMix.polyol : 0;
    $('additiveContext').textContent = `base: ${polyolG > 0 ? Calculator.num(polyolG, 1) + ' g de Poliol A' : 'calcula primero la dosificación'}`;

    const pigmentPct  = parseFloat($('inPigment').value)  || 0;
    const catalystPct = parseFloat($('inCatalyst').value) || 0;
    const releasePct  = parseFloat($('inRelease').value)  || 0;

    $('outPigmentPct').textContent  = pigmentPct.toFixed(1);
    $('outCatalystPct').textContent = catalystPct.toFixed(1);
    $('outReleasePct').textContent  = releasePct.toFixed(1);

    const add = Calculator.additives(polyolG, { pigmentPct, catalystPct, releasePct });
    $('outFlexG').textContent  = Calculator.num(polyolG * flexPct / 100, 1);
    $('outRigidG').textContent = Calculator.num(polyolG * (100 - flexPct) / 100, 1);
    $('outPigment').textContent  = Calculator.num(add.pigment, 1);
    $('outCatalyst').textContent = Calculator.num(add.catalyst, 1);
    $('outRelease').textContent  = Calculator.num(add.release, 1);

    paintRange($('inPigment'));
    paintRange($('inCatalyst'));
    paintRange($('inRelease'));
  }

  /* ============================================================
   * MÓDULO D — COSTOS
   * ============================================================ */
  function recalcCosts() {
    const mix = state.lastMix;
    const priceA = parseFloat($('inPolyolPrice').value) || 0;
    const priceB = parseFloat($('inIsoPrice').value) || 0;

    if (!mix || !mix.valid) {
      $('outCostKg').textContent = '0.00';
      return;
    }

    const costKg = Calculator.costPerKg(mix.pctA, mix.pctB, priceA, priceB);
    $('outCostKg').textContent = Calculator.num(costKg, 2);

    // Costo por tapa: requiere piezas (modo piezas) o masa de molde
    const pieces = parseFloat($('inPieces').value) || 0;
    const pieceMass = parseFloat($('inPieceMass').value) || 0;
    let massPerPiece = 0;
    if (state.dosMode === 'pieces' && pieces > 0) {
      massPerPiece = mix.totalWithWaste / pieces;
    } else if (pieceMass > 0) {
      massPerPiece = pieceMass * (1 + mix.wastePct / 100);
    }

    const pieceBox = $('costPieceBox');
    const batchBox = $('costBatchBox');
    pieceBox.classList.remove('hidden');
    pieceBox.classList.add('flex');
    batchBox.classList.remove('hidden');
    batchBox.classList.add('flex');

    if (massPerPiece > 0) {
      $('outCostPiece').textContent = Calculator.costPerPiece(massPerPiece, costKg).toFixed(4);
    } else {
      $('outCostPiece').textContent = '—';
    }

    $('outCostBatch').textContent = Calculator.num(
      Calculator.costBatch(mix.totalWithWaste, costKg), 2
    );
  }

  /* ---------- Recalculo encadenado ---------- */
  function recalcAll() {
    recalcMix();      // dispara recalcAdditives() y recalcCosts()
    recalcMold();
  }

  /* ============================================================
   * COPIAR REPORTE AL PORTAPAPELES
   * ============================================================ */
  async function copyMixReport() {
    const mix = state.lastMix;
    if (!mix || !mix.valid) {
      toast('No hay resultados válidos para copiar.', 'error');
      return;
    }
    const i = readInputs();
    const lines = [
      'CAR-SEV C.A. — Reporte de Dosificación',
      `Relación A:B = ${i.ratioA}:${i.ratioB}  ·  Merma ${Calculator.num(mix.wastePct, 1)}%`,
      '----------------------------------------',
      `Poliol (A):      ${Calculator.num(mix.polyol, 1)} g  (a bascular ≈ ${mix.polyolBatch} g)`,
      `Isocianato (B):  ${Calculator.num(mix.iso, 1)} g  (a bascular ≈ ${mix.isoBatch} g)`,
      `Total mezcla:    ${Calculator.num(mix.totalWithWaste, 1)} g`,
      `                 (base ${Calculator.num(mix.baseMass, 1)} g + merma ${Calculator.num(mix.wasteMass, 1)} g)`,
    ];
    const text = lines.join('\n');

    try {
      await navigator.clipboard.writeText(text);
      toast('Reporte copiado al portapapeles.', 'success');
    } catch (err) {
      // Fallback para contextos sin Clipboard API
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      toast(ok ? 'Reporte copiado.' : 'No se pudo copiar automáticamente.', ok ? 'success' : 'error');
    }
  }

  /* ============================================================
   * RECETAS — RENDER, GUARDAR, CARGAR, ELIMINAR
   * ============================================================ */
  function escapeHTML(str) {
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }

  function renderRecipes() {
    const list = Storage.getAllRecipes();
    const container = $('recipeList');
    const empty = $('recipesEmpty');
    $('recipeCount').textContent = list.length + (list.length === 1 ? ' receta' : ' recetas');

    empty.classList.toggle('hidden', list.length > 0);
    container.innerHTML = '';

    list.forEach((recipe) => {
      const r = recipe.results || {};
      const p = recipe.params || {};
      const date = recipe.createdAt ? new Date(recipe.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
      const badges = [
        r.ratioLabel || null,
        r.wastePct != null ? `merma ${Calculator.num(r.wastePct, 1)}%` : null,
        r.pieceMass > 0 ? `${Calculator.num(r.pieceMass, 1)} g/tapa` : null,
        r.costPerPiece > 0 ? `$${r.costPerPiece.toFixed(4)}/tapa` : null,
      ].filter(Boolean);

      const card = document.createElement('article');
      card.className = 'bg-slate-900/60 border border-slate-800 rounded-2xl p-4 flex flex-col gap-3';
      card.innerHTML = `
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0">
            <h4 class="font-bold text-slate-100 truncate">${escapeHTML(recipe.name)}</h4>
            <p class="font-mono text-[10px] text-slate-600 mt-0.5">${escapeHTML(date)}</p>
          </div>
          <span class="shrink-0 font-mono text-[10px] px-2 py-0.5 rounded bg-cyan-500/10 border border-cyan-500/25 text-cyan-400">#${escapeHTML(recipe.id.slice(-4))}</span>
        </div>
        <div class="flex flex-wrap gap-1.5">
          ${badges.map((b) => `<span class="font-mono text-[10px] px-2 py-0.5 rounded bg-slate-800 border border-slate-700 text-slate-400">${escapeHTML(b)}</span>`).join('')}
        </div>
        <div class="flex gap-2 mt-auto pt-1">
          <button data-action="load" class="flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 rounded-lg bg-cyan-500/10 border border-cyan-600/40 text-cyan-400 hover:bg-cyan-500/20 transition-colors">
            <i data-lucide="folder-open" class="w-3.5 h-3.5"></i> Cargar
          </button>
          <button data-action="export" class="flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg border border-slate-700 text-slate-400 hover:text-slate-200 transition-colors" title="Exportar esta receta">
            <i data-lucide="download" class="w-3.5 h-3.5"></i>
          </button>
          <button data-action="delete" class="flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg border border-slate-700 text-slate-500 hover:text-red-400 hover:border-red-500/40 transition-colors" title="Eliminar">
            <i data-lucide="trash-2" class="w-3.5 h-3.5"></i>
          </button>
        </div>`;

      // Cargar receta → aplica parámetros a la interfaz
      card.querySelector('[data-action="load"]').addEventListener('click', () => {
        applyRecipe(recipe);
        toast(`Receta "${recipe.name}" cargada.`, 'success');
        showPanel('dosificacion');
      });

      // Exportar receta individual
      card.querySelector('[data-action="export"]').addEventListener('click', () => {
        const blob = new Blob([JSON.stringify({ recipes: [recipe] }, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `receta-${recipe.name.replace(/[^\w\-]+/g, '_')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      });

      // Eliminar con confirmación inline (sin confirm() nativo)
      const delBtn = card.querySelector('[data-action="delete"]');
      delBtn.addEventListener('click', () => {
        if (delBtn.dataset.armed === '1') {
          Storage.removeRecipe(recipe.id);
          renderRecipes();
          toast(`Receta "${recipe.name}" eliminada.`, 'success');
        } else {
          delBtn.dataset.armed = '1';
          delBtn.classList.add('text-red-400', 'border-red-500/60', 'bg-red-500/10');
          delBtn.title = 'Pulsa de nuevo para confirmar';
          setTimeout(() => {
            delBtn.dataset.armed = '0';
            delBtn.classList.remove('text-red-400', 'border-red-500/60', 'bg-red-500/10');
          }, 3000);
        }
      });

      container.appendChild(card);
    });

    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
  }

  function snapshotResults() {
    const mix = state.lastMix;
    const costKg = (() => {
      if (!mix || !mix.valid) return 0;
      return Calculator.costPerKg(
        mix.pctA, mix.pctB,
        parseFloat($('inPolyolPrice').value) || 0,
        parseFloat($('inIsoPrice').value) || 0
      );
    })();
    const pieces = parseFloat($('inPieces').value) || 0;
    const pieceMass = parseFloat($('inPieceMass').value) || 0;
    let massPerPiece = 0;
    if (mix && mix.valid) {
      massPerPiece = (state.dosMode === 'pieces' && pieces > 0)
        ? mix.totalWithWaste / pieces
        : pieceMass > 0 ? pieceMass * (1 + mix.wastePct / 100) : 0;
    }
    return {
      polyolG: mix && mix.valid ? mix.polyol : 0,
      isoG: mix && mix.valid ? mix.iso : 0,
      totalG: mix && mix.valid ? mix.totalWithWaste : 0,
      wastePct: mix && mix.valid ? mix.wastePct : null,
      ratioLabel: `${$('inRatioA').value || '—'}:${$('inRatioB').value || '—'}`,
      pieceMass: massPerPiece,
      costPerKg: costKg,
      costPerPiece: massPerPiece > 0 ? Calculator.costPerPiece(massPerPiece, costKg) : 0,
      shoreA: Calculator.shoreEstimate(parseFloat($('inFlex').value) || 0),
    };
  }

  function saveCurrentRecipe() {
    const name = $('inRecipeName').value.trim();
    if (!name) {
      toast('Ponle un nombre al modelo de filtro antes de guardar.', 'error');
      $('inRecipeName').focus();
      return;
    }
    const recipe = {
      name,
      params: {
        dosMode: state.dosMode,
        totalWeight: parseFloat($('inTotalWeight').value) || 0,
        totalUnit: $('selTotalUnit').value,
        pieces: parseFloat($('inPieces').value) || 0,
        pieceMass: parseFloat($('inPieceMass').value) || 0,
        ratioA: parseFloat($('inRatioA').value) || 0,
        ratioB: parseFloat($('inRatioB').value) || 0,
        wastePct: parseFloat($('inWaste').value) || 0,
        moldShape: state.moldShape,
        outerD: parseFloat($('inOuterD').value) || 0,
        innerD: parseFloat($('inInnerD').value) || 0,
        height: parseFloat($('inHeight').value) || 0,
        dimUnit: $('selDimUnit').value,
        directVolume: parseFloat($('inDirectVol').value) || 0,
        density: parseFloat($('inDensity').value) || 1.15,
        flexPct: parseFloat($('inFlex').value) || 0,
        pigmentPct: parseFloat($('inPigment').value) || 0,
        catalystPct: parseFloat($('inCatalyst').value) || 0,
        releasePct: parseFloat($('inRelease').value) || 0,
        polyolPrice: parseFloat($('inPolyolPrice').value) || 0,
        isoPrice: parseFloat($('inIsoPrice').value) || 0,
      },
      results: snapshotResults(),
    };
    const res = Storage.saveRecipe(recipe);
    if (res.ok) {
      $('inRecipeName').value = '';
      renderRecipes();
      toast(`Receta "${name}" guardada en este dispositivo.`, 'success');
    } else {
      toast(res.error || 'No se pudo guardar la receta.', 'error');
    }
  }

  function applyRecipe(recipe) {
    const p = recipe.params || {};
    // Modos y relación
    if (p.dosMode) {
      const radio = document.querySelector(`input[name="dosMode"][value="${p.dosMode}"]`);
      if (radio) radio.checked = true;
      state.dosMode = p.dosMode;
    }
    $('weightModeBox').classList.toggle('hidden', state.dosMode !== 'weight');
    $('piecesModeBox').classList.toggle('hidden', state.dosMode !== 'pieces');

    const setVal = (id, v) => { if (v != null) $(id).value = v; };
    setVal('inTotalWeight', p.totalWeight);
    setVal('selTotalUnit', p.totalUnit);
    setVal('inPieces', p.pieces);
    setVal('inPieceMass', p.pieceMass);
    setVal('inWaste', p.wastePct);
    setVal('inOuterD', p.outerD);
    setVal('inInnerD', p.innerD);
    setVal('inHeight', p.height);
    setVal('selDimUnit', p.dimUnit);
    setVal('inDirectVol', p.directVolume);
    setVal('inDensity', p.density);
    setVal('inFlex', p.flexPct);
    setVal('inPigment', p.pigmentPct);
    setVal('inCatalyst', p.catalystPct);
    setVal('inRelease', p.releasePct);
    setVal('inPolyolPrice', p.polyolPrice);
    setVal('inIsoPrice', p.isoPrice);

    if (p.moldShape) {
      const radio = document.querySelector(`input[name="moldShape"][value="${p.moldShape}"]`);
      if (radio) radio.checked = true;
      state.moldShape = p.moldShape;
      updateMoldShapeUI();
    }

    // Restaurar el chip de relación correcto
    const isCustom = ![100, 50, 40, 30].some((b) => p.ratioA === 100 && p.ratioB === b) || p.ratioA !== 100;
    setActiveRatio(p.ratioA ?? 100, p.ratioB ?? 50, isCustom && p.ratioA != null);

    recalcAll();
  }

  /* ============================================================
   * SESIÓN — restauración automática tras recarga
   * ============================================================ */
  const SESSION_FIELDS = [
    'inTotalWeight', 'selTotalUnit', 'inPieces', 'inPieceMass',
    'inWaste', 'inOuterD', 'inInnerD', 'inHeight', 'selDimUnit',
    'inDirectVol', 'inDensity', 'inFlex',
    'inPigment', 'inCatalyst', 'inRelease',
    'inPolyolPrice', 'inIsoPrice',
  ];

  function persistSession() {
    const data = {};
    SESSION_FIELDS.forEach((id) => { data[id] = $(id).value; });
    data._dosMode = state.dosMode;
    data._moldShape = state.moldShape;
    data._ratioA = state.activeRatio.a;
    data._ratioB = state.activeRatio.b;
    data._ratioCustom = state.activeRatio.custom;
    Storage.saveSession(data);
  }

  function restoreSession() {
    const data = Storage.loadSession();
    if (!data) return false;
    SESSION_FIELDS.forEach((id) => {
      if (data[id] != null) $(id).value = data[id];
    });
    if (data._dosMode) {
      const radio = document.querySelector(`input[name="dosMode"][value="${data._dosMode}"]`);
      if (radio) radio.checked = true;
      state.dosMode = data._dosMode;
    }
    if (data._moldShape) {
      const radio = document.querySelector(`input[name="moldShape"][value="${data._moldShape}"]`);
      if (radio) radio.checked = true;
      state.moldShape = data._moldShape;
    }
    if (data._ratioA != null) {
      state.activeRatio = { a: data._ratioA, b: data._ratioB, custom: !!data._ratioCustom };
    }
    return true;
  }

  /* ============================================================
   * PWA — Service Worker, instalación y conexión
   * ============================================================ */
  function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js')
        .then((reg) => {
          // Detectar actualizaciones del SW y avisar al usuario
          reg.addEventListener('updatefound', () => {
            const sw = reg.installing;
            if (!sw) return;
            sw.addEventListener('statechange', () => {
              if (sw.state === 'installed' && navigator.serviceWorker.controller) {
                toast('Nueva versión disponible. Reinicia la app para actualizar.', 'info');
              }
            });
          });
        })
        .catch((err) => console.warn('[PWA] Error registrando SW:', err));
    });
  }

  function setupInstallPrompt() {
    const fab = $('installFab');
    const topBtn = $('installBtnTop');

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      state.deferredPrompt = e;
      fab.classList.remove('hidden');
      fab.classList.add('flex');
      topBtn.classList.remove('hidden');
      topBtn.classList.add('inline-flex');
    });

    const doInstall = async () => {
      if (!state.deferredPrompt) {
        toast('Tu navegador ya instaló la app, o no soporta instalación directa. Usa "Añadir a pantalla de inicio" del menú del navegador.', 'info');
        return;
      }
      state.deferredPrompt.prompt();
      const { outcome } = await state.deferredPrompt.userChoice;
      if (outcome === 'accepted') toast('¡CAR-SEV instalada en tu dispositivo!', 'success');
      state.deferredPrompt = null;
      fab.classList.add('hidden');
      fab.classList.remove('flex');
      topBtn.classList.add('hidden');
      topBtn.classList.remove('inline-flex');
    };

    fab.addEventListener('click', doInstall);
    topBtn.addEventListener('click', doInstall);

    window.addEventListener('appinstalled', () => {
      fab.classList.add('hidden');
      fab.classList.remove('flex');
      topBtn.classList.add('hidden');
      topBtn.classList.remove('inline-flex');
      state.deferredPrompt = null;
      toast('Aplicación instalada. Ya funciona sin conexión.', 'success');
    });
  }

  function setupConnectionIndicator() {
    const update = () => {
      const online = navigator.onLine;
      const pill = $('statusPill');
      const dot = $('statusDot');
      const text = $('statusText');
      pill.classList.toggle('border-emerald-500/40', online);
      pill.classList.toggle('text-emerald-400', online);
      pill.classList.toggle('bg-emerald-500/10', online);
      pill.classList.toggle('border-amber-500/40', !online);
      pill.classList.toggle('text-amber-400', !online);
      pill.classList.toggle('bg-amber-500/10', !online);
      dot.classList.toggle('bg-emerald-400', online);
      dot.classList.toggle('bg-amber-400', !online);
      text.textContent = online ? 'En línea' : 'Offline';
    };
    window.addEventListener('online', () => { update(); toast('Conexión restablecida.', 'success'); });
    window.addEventListener('offline', () => { update(); toast('Sin conexión: la app sigue funcionando con datos locales.', 'info'); });
    update();
  }

  /* ============================================================
   * GEOMETRÍA DEL MOLDE — visibilidad de campos
   * ============================================================ */
  function updateMoldShapeUI() {
    const shape = state.moldShape;
    $('dimsBox').classList.toggle('hidden', shape === 'direct');
    $('directBox').classList.toggle('hidden', shape !== 'direct');
    $('inInnerDWrap').classList.toggle('hidden', shape === 'cylinder');
  }

  /* ============================================================
   * BINDING DE EVENTOS
   * ============================================================ */
  function bindEvents() {
    // Navegación (desktop y móvil comparten data-panel)
    document.querySelectorAll('[data-panel]').forEach((btn) => {
      btn.addEventListener('click', () => showPanel(btn.dataset.panel));
    });

    // Modo de dosificación
    document.querySelectorAll('input[name="dosMode"]').forEach((radio) => {
      radio.addEventListener('change', () => setDosMode(radio.value));
    });

    // Chips de relación preconfigurados
    document.querySelectorAll('.ratio-chip').forEach((chip) => {
      chip.addEventListener('click', () => setActiveRatio(parseFloat(chip.dataset.a), parseFloat(chip.dataset.b), false));
    });
    $('btnRatioCustom').addEventListener('click', () => {
      setActiveRatio(parseFloat($('inRatioA').value) || 100, parseFloat($('inRatioB').value) || 50, true);
    });

    // Entradas de los 4 módulos → recálculo reactivo + sesión
    const recalcTriggers = [
      'inTotalWeight', 'selTotalUnit', 'inPieces', 'inPieceMass',
      'inRatioA', 'inRatioB', 'inWaste',
      'inOuterD', 'inInnerD', 'inHeight', 'selDimUnit', 'inDirectVol',
      'inDensity', 'inFlex', 'inPigment', 'inCatalyst', 'inRelease',
      'inPolyolPrice', 'inIsoPrice',
    ];
    let sessionTimer = null;
    const onAnyInput = () => {
      if (state.activeRatio.custom) {
        // Mantener sincronizado el estado de relación personalizada
        state.activeRatio.a = parseFloat($('inRatioA').value) || 0;
        state.activeRatio.b = parseFloat($('inRatioB').value) || 0;
      }
      recalcAll();
      clearTimeout(sessionTimer);
      sessionTimer = setTimeout(persistSession, 400);
    };
    recalcTriggers.forEach((id) => {
      const node = $(id);
      node.addEventListener('input', onAnyInput);
      node.addEventListener('change', onAnyInput);
    });

    // Geometría del molde
    document.querySelectorAll('input[name="moldShape"]').forEach((radio) => {
      radio.addEventListener('change', () => {
        state.moldShape = radio.value;
        updateMoldShapeUI();
        recalcMold();
        persistSession();
      });
    });

    // Usar masa del molde en dosificación
    $('btnUseMass').addEventListener('click', () => {
      if (!state.lastMold || state.lastMold.pieceMass <= 0) return;
      $('inPieceMass').value = state.lastMold.pieceMass.toFixed(1);
      const radio = document.querySelector('input[name="dosMode"][value="pieces"]');
      if (radio) radio.checked = true;
      setDosMode('pieces');
      toast('Masa del molde enviada a Dosificación.', 'success');
    });
    $('btnUseMoldMass').addEventListener('click', () => {
      if (!state.lastMold || state.lastMold.pieceMass <= 0) return;
      $('inPieceMass').value = state.lastMold.pieceMass.toFixed(1);
      recalcAll();
      toast('Masa del molde aplicada.', 'success');
    });

    // Copiar reporte
    $('btnCopyMix').addEventListener('click', copyMixReport);

    // Recetas
    $('btnSaveRecipe').addEventListener('click', saveCurrentRecipe);
    $('inRecipeName').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') saveCurrentRecipe();
    });

    $('btnExportAll').addEventListener('click', () => {
      const n = Storage.exportAllRecipes();
      toast(n > 0 ? `Respaldo de ${n} receta(s) descargado.` : 'No hay recetas para exportar.', n > 0 ? 'success' : 'info');
    });

    $('btnImport').addEventListener('click', () => $('importFile').click());
    $('importFile').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const res = Storage.importRecipes(String(reader.result));
        if (res.ok) {
          renderRecipes();
          toast(`${res.imported} receta(s) importada(s).`, 'success');
        } else {
          toast(res.error || 'No se pudo importar el archivo.', 'error');
        }
      };
      reader.onerror = () => toast('Error leyendo el archivo.', 'error');
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  /* ============================================================
   * ARRANQUE
   * ============================================================ */
  function init() {
    // 1) Restaurar sesión previa (si existe)
    restoreSession();

    // 2) Sincronizar visibilidad de controles con el estado restaurado
    $('weightModeBox').classList.toggle('hidden', state.dosMode !== 'weight');
    $('piecesModeBox').classList.toggle('hidden', state.dosMode !== 'pieces');
    updateMoldShapeUI();

    // 3) Marcar el chip de relación activo sin recalcular aún
    const { a, b, custom } = state.activeRatio;
    $('inRatioA').value = a;
    $('inRatioB').value = b;
    $('customRatioBox').classList.toggle('hidden', !custom);
    document.querySelectorAll('.ratio-chip').forEach((chip) => {
      const match = !custom && parseFloat(chip.dataset.a) === a && parseFloat(chip.dataset.b) === b;
      chip.classList.toggle('ratio-active', match);
    });
    $('btnRatioCustom').classList.toggle('ratio-active', !!custom);

    // 4) Pintar sliders y calcular todo
    ['inWaste', 'inDensity', 'inFlex', 'inPigment', 'inCatalyst', 'inRelease'].forEach((id) => paintRange($(id)));
    recalcAll();

    // 5) Interfaz
    bindEvents();
    renderRecipes();
    showPanel((location.hash || '#dosificacion').slice(1));
    setupConnectionIndicator();
    setupInstallPrompt();
    registerServiceWorker();

    // Iconos
    if (window.lucide) lucide.createIcons({ nameAttr: 'data-lucide' });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();