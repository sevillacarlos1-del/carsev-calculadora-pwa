/* ============================================================
 * CAR-SEV C.A. — Motor de cálculo estequiométrico
 * Todos los cálculos internos trabajan en gramos y cm³.
 * Método expuesto como objeto global (script clásico, sin build).
 *
 * v1.2.0:
 *  · Huecos = VENTANAS CURVAS (sectores anulares) que siguen la
 *    circunferencia del anillo. Ya no son círculos con Ø propio.
 *  · Ángulo automático:  paso = 360° / N
 *                        apertura efectiva = paso − RIB_MARGIN_DEG
 *  · Descuento de volumen:
 *      Área ventana  = (θ_eff / 360°) · π · (Re² − Ri²)
 *      Vol. restado  = Área ventana · Espesor(H) · N
 * ============================================================ */

'use strict';

const Calculator = (() => {

  /* ---------- Constantes químicas y de planta ---------- */
  const SHORE_FLEX  = 62;   // Shore A aprox. de poliol 100% flexible colado
  const SHORE_RIGID = 84;   // Shore A aprox. de poliol 100% rígido colado
  const DENSITY_MIN = 0.80;
  const DENSITY_MAX = 1.60;
  const WASTE_FIXED = 0.5;  // % FIJO de merma/seguridad (protocolo CAR-SEV). No ajustar por UI.
  const HOLES_MIN   = 4;    // Mínimo de ventanas curvas por tapa
  const HOLES_MAX   = 12;   // Máximo de ventanas curvas por tapa
  const RIB_MARGIN_DEG = 6; // Margen angular ESTÁNDAR por ventana para nervios/separadores (°)

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
   * Tapa con huecos (VENTANAS CURVAS — sectores anulares):
   *   paso angular       = 360° / N
   *   apertura efectiva  = paso − RIB_MARGIN_DEG   (nervios)
   *   área por ventana   = (θ_eff / 360°) · π · (Re² − Ri²)
   *   volumen restado    = área por ventana · H · N
   *
   * Las ventanas requieren geometría ANULAR: el sector anular está
   * definido por los radios del anillo (Re² − Ri²).
   * ============================================================ */
  function moldVolume({
    shape,        // 'annular' | 'cylinder' | 'direct'
    capType,      // 'sealed' | 'holes'
    holesCount,   // 4–12 ventanas curvas
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

    /* ---- Descuento por ventanas curvas (sectores anulares) ---- */
    let holesVolume = 0;
    let windows = null;

    if (capType === 'holes') {
      // La fórmula del sector anular exige radios interior y exterior
      if (shape !== 'annular') {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume: 0, windows: null,
                 reason: 'Las ventanas curvas siguen la circunferencia del anillo: selecciona geometría Anular para el modo con huecos.' };
      }

      const n = clamp(Math.round(holesCount || 0), HOLES_MIN, HOLES_MAX);

      // Cálculo automático del arco: 360° repartidos entre N ventanas
      const pitchDeg = 360 / n;
      const effDeg   = pitchDeg - RIB_MARGIN_DEG;

      if (effDeg <= 0) {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume: 0, windows: null,
                 reason: `Con ${n} ventanas y nervio estándar de ${RIB_MARGIN_DEG}° no queda apertura efectiva. Reduce el nervio o la cantidad de ventanas.` };
      }

      // Área de la ventana curva: fracción angular del área total del anillo
      const annulusArea = Math.PI * (Math.pow(DE / 2, 2) - Math.pow(DI / 2, 2));
      const windowArea  = (effDeg / 360) * annulusArea;

      // Volumen total restado = área · espesor(H) · cantidad de ventanas
      holesVolume = windowArea * H * n;

      // Guardia defensiva: el descuento jamás debe superar la cavidad
      if (holesVolume >= gross) {
        return { valid: false, volume: 0, grossVolume: gross, holesVolume, windows: null,
                 reason: 'Las ventanas descontarían más volumen que el de la cavidad. Revisa dimensiones.' };
      }

      // Datos para la UI y el plano: arco medido sobre el radio medio
      const rMid = (DE + DI) / 4;
      windows = {
        count: n,
        pitchDeg,
        ribDeg: RIB_MARGIN_DEG,
        effDeg,
        windowAreaCm2: windowArea,
        arcLenCm: (effDeg * Math.PI / 180) * rMid,
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