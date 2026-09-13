/* ============================================================
 * CAR-SEV C.A. — Motor de cálculo estequiométrico
 * Todos los cálculos internos trabajan en gramos y cm³.
 * Método expuesto como objeto global (script clásico, sin build).
 *
 * v1.2.2:
 *  · RANURAS OVALADAS CURVAS (cápsulas en arco) con RADIO CENTRAL
 *    DEFINIDO POR EL OPERADOR: la ranura ya no se centra
 *    automáticamente en el anillo; el usuario fija la distancia
 *    del centro de la tapa al eje del canal (alineación con el
 *    cilindro interno del filtro, borde externo, etc.).
 *  · Geometría exacta de la cápsula sobre radio R:
 *      apertura punta-a-punta  θeff = 360°/N − nervio
 *      span central            θc   = θeff − 2·arcsen(w / 2R)
 *      área por ranura         A    = θc·R·w + π·(w/2)²
 *      volumen restado         V    = A · H · N
 *  · Validación de encaje radial:
 *      R − w/2 ≥ Ø_int/2   (no invade el centro)
 *      R + w/2 ≤ Ø_ext/2   (no se sale del plato)
 *  · Merma fija 0.5 % y Tapa Sellada sin cambios.
 * ============================================================ */

'use strict';

const Calculator = (() => {

  /* ---------- Constantes químicas y de planta ---------- */
  const SHORE_FLEX  = 62;   // Shore A aprox. de poliol 100% flexible colado
  const SHORE_RIGID = 84;   // Shore A aprox. de poliol 100% rígido colado
  const DENSITY_MIN = 0.80;
  const DENSITY_MAX = 1.60;
  const WASTE_FIXED = 0.5;  // % FIJO de merma/seguridad (protocolo CAR-SEV). No ajustar por UI.
  const HOLES_MIN   = 4;    // Mínimo de ranuras curvas por tapa
  const HOLES_MAX   = 12;   // Máximo de ranuras curvas por tapa
  const RIB_MARGIN_DEG = 6; // Margen angular ESTÁNDAR entre puntas de ranuras para nervios (°)

  /* ---------- Utilidades ---------- */

  /** Convierte un peso (g|kg) a gramos. */
  function toGrams(value, unit) {
    return unit === 'kg' ? value * 1000 : value;
  }

  /** Redondeo a gramos enteros para báscula. */
  function roundToGrams(grams) {
    return Math.max(0, Math.round(grams));
  }

  /** Número con coma decimal española y n decimales. */
  function num(value, decimals = 1) {
    if (!isFinite(value)) return '—';
    return value.toLocaleString('es', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  /* ============================================================
   * MÓDULO A — Dosificación estequiométrica
   *
   * La mezcla total (con merma) se reparte según la relación
   * en peso A:B. La merma se distribuye proporcionalmente para
   * mantener el índice de NCO real de la formulación.
   * La app pasa siempre wastePct = WASTE_FIXED (0.5 %).
   * ============================================================ */
  function computeMix({
    mode,               // 'weight' | 'pieces'
    totalWeight,        // número (en la unidad indicada)
    totalUnit,          // 'g' | 'kg'
    pieces,             // cantidad de tapas
    pieceMass,          // gramos por tapa
    ratioA,             // partes en peso de Poliol
    ratioB,             // partes en peso de Isocianato
    wastePct,           // % de merma (la UI siempre envía WASTE_FIXED)
  }) {
    const a = Math.max(0, ratioA || 0);
    const b = Math.max(0, ratioB || 0);
    const sum = a + b;

    if (sum <= 0) {
      return { valid: false, reason: 'La relación A:B no puede ser cero.' };
    }

    // 1) Masa base reactiva según el modo de trabajo
    let baseMass = 0;
    if (mode === 'weight') {
      baseMass = toGrams(Math.max(0, totalWeight || 0), totalUnit);
    } else {
      baseMass = Math.max(0, pieces || 0) * Math.max(0, pieceMass || 0);
    }

    if (baseMass <= 0) {
      return { valid: false, reason: 'Ingresa una masa o cantidad de piezas válida.' };
    }

    // 2) Aplicación del factor de merma (0.5 % fijo desde la UI)
    const waste = clamp(wastePct || 0, 0, 15);
    const wasteFactor = 1 + waste / 100;
    const totalWithWaste = baseMass * wasteFactor;
    const wasteMass = totalWithWaste - baseMass;

    // 3) Reparto estequiométrico en peso
    const polyol = totalWithWaste * (a / sum);
    const iso    = totalWithWaste * (b / sum);

    return {
      valid: true,
      baseMass,
      wastePct: waste,
      wasteMass,
      totalWithWaste,
      polyol,
      iso,
      polyolBatch: roundToGrams(polyol),
      isoBatch: roundToGrams(iso),
      pctA: (a / sum) * 100,
      pctB: (b / sum) * 100,
    };
  }

  /* ============================================================
   * MÓDULO B — Cubaje del molde (cm³) y masa por tapa
   *
   * Tapa sellada:
   *   Anular:     V = π/4 · (DE² − DI²) · H
   *   Cilíndrico: V = π/4 · D² · H
   *   Directo:    V = valor ingresado en cm³ (se considera neto)
   *
   * Tapa con huecos (RANURAS OVALADAS CURVAS — cápsulas en arco):
   *   Cada ranura es un canal de ancho constante w trazado sobre el
   *   RADIO CENTRAL R definido por el operador (posición radial
   *   exacta del eje del canal), con extremos semicirculares de
   *   radio rc = w/2.
   *
   *   paso angular (centro a centro)  = 360° / N
   *   apertura punta-a-punta          θeff = paso − nervio
   *   span central del arco           θc   = θeff − 2·arcsen(rc / R)
   *   área del tramo en arco          = θc · R · w
   *   área de los extremos redondeados = π · rc²  (dos semicírculos)
   *   área total por ranura           = θc·R·w + π·rc²
   *   volumen restado                 = área · H · N
   *
   *   Encaje radial exigido (en cm):
   *     R − rc ≥ DI/2   (borde interno no invade el centro)
   *     R + rc ≤ DE/2   (borde externo no sale del plato)
   * ============================================================ */
  function moldVolume({
    shape,        // 'annular' | 'cylinder' | 'direct'
    capType,      // 'sealed' | 'holes'
    holesCount,   // 4–12 ranuras curvas
    slotWidth,    // ancho de ranura w (mm)
    slotRadius,   // radio central del canal R, desde el centro de la tapa (mm)
    outerD, innerD, height, unit,
    directVolume,
  }) {
    if (shape === 'direct') {
      const v = Math.max(0, directVolume || 0);
      return {
        valid: v > 0,
        volume: v,
        grossVolume: v,
        holesVolume: 0,
        windows: null,
        reason: v > 0 ? '' : 'Ingresa un volumen válido.',
      };
    }

    // Normalización de unidades a cm
    const f = unit === 'mm' ? 0.1 : 1;
    const DE = (outerD || 0) * f;
    const DI = (innerD || 0) * f;
    const H  = (height  || 0) * f;

    if (DE <= 0 || H <= 0) {
      return { valid: false, volume: 0, grossVolume: 0, holesVolume: 0, windows: null,
               reason: 'El diámetro exterior y la altura deben ser mayores que cero.' };
    }
    if (shape === 'annular' && (DI <= 0 || DI >= DE)) {
      return { valid: false, volume: 0, grossVolume: 0, holesVolume: 0, windows: null,
               reason: 'En molde anular, el Ø interior debe ser menor que el Ø exterior.' };
    }

    const gross = shape === 'annular'
      ? (Math.PI / 4) * (DE * DE - DI * DI) * H
      : (Math.PI / 4) * DE * DE * H;

    /* ---- Descuento por ranuras curvas (cápsulas en arco) ---- */
    let holesVolume = 0;
    let windows = null;

    if (capType === 'holes') {
      // El canal concéntrico exige radios interior y exterior
      if (shape !== 'annular') {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume: 0, windows: null,
                 reason: 'Las ranuras curvas siguen la circunferencia de la tapa: selecciona geometría Anular para el modo con huecos.' };
      }

      const n = clamp(Math.round(holesCount || 0), HOLES_MIN, HOLES_MAX);

      const wMm = Math.max(0, slotWidth || 0);
      if (wMm <= 0) {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume: 0, windows: null,
                 reason: 'Ingresa el ancho de cada ranura curva en milímetros.' };
      }

      const RMm = Math.max(0, slotRadius || 0);
      if (RMm <= 0) {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume: 0, windows: null,
                 reason: 'Ingresa el radio central de la ranura (distancia del centro de la tapa al eje del canal) en milímetros.' };
      }

      const wCm  = wMm / 10;
      const wMaxCm = DE - DI; // ancho radial disponible del anillo
      if (wCm >= wMaxCm) {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume: 0, windows: null,
                 reason: `El ancho de ranura (${num(wMm, 1)} mm) debe ser menor que el ancho del anillo (${num(wMaxCm * 10, 1)} mm = Ø ext − Ø int).` };
      }

      // Cálculo automático del arco: 360° repartidos entre N ranuras
      const pitchDeg = 360 / n;
      const effDeg   = pitchDeg - RIB_MARGIN_DEG;

      if (effDeg <= 0) {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume: 0, windows: null,
                 reason: `Con ${n} ranuras y nervio estándar de ${RIB_MARGIN_DEG}° no queda apertura efectiva. Reduce el nervio o la cantidad de ranuras.` };
      }

      const R  = RMm / 10;  // radio central del canal (cm) — definido por el operador
      const rc = wCm / 2;   // radio de los extremos semicirculares (cm)

      /* ---- Encaje radial: la ranura debe vivir DENTRO del anillo ---- */
      const minRMm = (DI / 2 + rc) * 10;  // borde interno en el Ø interior
      const maxRMm = (DE / 2 - rc) * 10;  // borde externo en el Ø exterior

      if (R - rc < DI / 2) {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume: 0, windows: null,
                 reason: `El radio central de la ranura (${num(RMm, 1)} mm) es demasiado bajo: con un ancho de ${num(wMm, 1)} mm, el borde interno invade el centro. Mínimo permitido: ${num(minRMm, 1)} mm.` };
      }
      if (R + rc > DE / 2) {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume: 0, windows: null,
                 reason: `El radio central de la ranura (${num(RMm, 1)} mm) es demasiado alto: con un ancho de ${num(wMm, 1)} mm, el borde externo se sale del plato. Máximo permitido: ${num(maxRMm, 1)} mm.` };
      }

      // El span central se recorta por los semicírculos de las puntas:
      // cada punta subtiende arcsen(rc/R) visto desde el centro.
      const effRad      = (effDeg * Math.PI) / 180;
      const thetaCenter = effRad - 2 * Math.asin(Math.min(1, rc / R));

      if (thetaCenter <= 0) {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume: 0, windows: null,
                 reason: `Con ${n} ranuras (apertura ${num(effDeg, 1)}°), un ancho de ${num(wMm, 1)} mm a radio ${num(RMm, 1)} mm hace solapar los extremos redondeados. Reduce el ancho, sube el radio o usa menos ranuras.` };
      }

      // Área EXACTA de la cápsula en arco sobre el radio R:
      // tramo recto-en-arco (θc·R·w) + dos semicírculos (π·rc²)
      const windowArea = R * wCm * thetaCenter + Math.PI * rc * rc;

      // Volumen total restado = área · espesor(H) · cantidad de ranuras
      holesVolume = windowArea * H * n;

      // Guardia defensiva: el descuento jamás debe superar la cavidad
      if (holesVolume >= gross) {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume, windows: null,
                 reason: 'Las ranuras descontarían más volumen que el de la cavidad. Revisa dimensiones.' };
      }

      // Datos para la UI y el plano
      windows = {
        count: n,
        pitchDeg,
        ribDeg: RIB_MARGIN_DEG,
        effDeg,
        slotWidthCm: wCm,
        centerRadiusCm: R,               // radio central definido por el operador
        centerRadiusMm: RMm,
        minRadiusMm: minRMm,             // rango válido para guiar al operador
        maxRadiusMm: maxRMm,
        capRadiusCm: rc,
        thetaCenterRad: thetaCenter,
        arcLenCm: thetaCenter * R,       // longitud del arco de centro del canal
        windowAreaCm2: windowArea,
        windowVolCm3: windowArea * H,
        holesVolumeCm3: holesVolume,
      };
    }

    return {
      valid: true,
      volume: gross - holesVolume,
      grossVolume: gross,
      holesVolume,
      windows,
    };
  }

  /** Masa (g) = Volumen neto (cm³) × Densidad (g/cm³). */
  function massFromVolume(volumeCm3, density) {
    const d = clamp(density || 0, DENSITY_MIN, DENSITY_MAX);
    return Math.max(0, volumeCm3 || 0) * d;
  }

  /* ============================================================
   * MÓDULO C — Aditivos (% sobre masa de Poliol) y Shore A
   * ============================================================ */
  function additives(polyolGrams, { pigmentPct, catalystPct, releasePct }) {
    const base = Math.max(0, polyolGrams || 0);
    return {
      pigment:  base * (pigmentPct  || 0) / 100,
      catalyst: base * (catalystPct || 0) / 100,
      release:  base * (releasePct  || 0) / 100,
    };
  }

  /**
   * Estimación referencial de Shore A por interpolación lineal
   * entre poliol 100% flexible (≈62A) y 100% rígido (≈84A).
   * @param {number} flexPct 0–100 % de poliol flexible
   */
  function shoreEstimate(flexPct) {
    const rigidFraction = clamp(100 - flexPct, 0, 100) / 100;
    return SHORE_FLEX + (SHORE_RIGID - SHORE_FLEX) * rigidFraction;
  }

  /* ============================================================
   * MÓDULO D — Costos (USD)
   * ============================================================ */

  /** Costo por kilo de mezcla activa, según la proporción A:B. */
  function costPerKg(pctA, pctB, polyolPrice, isoPrice) {
    return (pctA / 100) * (polyolPrice || 0) + (pctB / 100) * (isoPrice || 0);
  }

  /** Costo total del lote en curso (incluye merma: la merma también se paga). */
  function costBatch(totalWithWasteGrams, costPerKgValue) {
    return (Math.max(0, totalWithWasteGrams || 0) / 1000) * (costPerKgValue || 0);
  }

  /** Costo por tapa dado su peso con merma proporcional. */
  function costPerPiece(pieceMassGrams, costPerKgValue) {
    return (Math.max(0, pieceMassGrams || 0) / 1000) * (costPerKgValue || 0);
  }

  /* ---------- API pública ---------- */
  return {
    SHORE_FLEX,
    SHORE_RIGID,
    DENSITY_MIN,
    DENSITY_MAX,
    WASTE_FIXED,
    HOLES_MIN,
    HOLES_MAX,
    RIB_MARGIN_DEG,
    toGrams,
    roundToGrams,
    num,
    clamp,
    computeMix,
    moldVolume,
    massFromVolume,
    additives,
    shoreEstimate,
    costPerKg,
    costBatch,
    costPerPiece,
  };
})();