/* ============================================================
 * CAR-SEV C.A. — Persistencia local (localStorage)
 * Manejo defensivo: cuotas llenas, modo privado, JSON corrupto.
 * Esquema de receta v1 documentado en RecipeSchema.
 * ============================================================ */

'use strict';

const Storage = (() => {

  const RECIPES_KEY = 'carsev_recipes_v1';
  const SESSION_KEY = 'carsev_session_v1';

  /* ---------- Seguridad de acceso a localStorage ---------- */
  function safeGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      console.warn('[Storage] localStorage no disponible:', err);
      return null;
    }
  }

  function safeSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
      return true;
    } catch (err) {
      console.warn('[Storage] No se pudo escribir en localStorage:', err);
      return false;
    }
  }

  function parseJSON(raw, fallback) {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch (err) {
      console.warn('[Storage] JSON corrupto, se descarta:', err);
      return fallback;
    }
  }

  /* ============================================================
   * RECETAS
   * ============================================================ */

  /** Lee todas las recetas ordenadas de más reciente a más antigua. */
  function getAllRecipes() {
    const list = parseJSON(safeGet(RECIPES_KEY), []);
    return Array.isArray(list) ? list : [];
  }

  /**
   * Guarda una receta nueva. Genera id único y fecha.
   * @returns {{ok: boolean, recipe?: object, error?: string}}
   */
  function saveRecipe(recipe) {
    if (!recipe || typeof recipe !== 'object') {
      return { ok: false, error: 'Datos de receta inválidos.' };
    }
    const now = new Date().toISOString();
    const full = {
      id: 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
      createdAt: now,
      updatedAt: now,
      schema: 1,
      ...recipe,
    };
    const list = getAllRecipes();
    list.unshift(full);
    const ok = safeSet(RECIPES_KEY, JSON.stringify(list));
    if (!ok) return { ok: false, error: 'Almacenamiento lleno o no disponible.' };
    return { ok: true, recipe: full };
  }

  /** Elimina una receta por id. Devuelve true si existía. */
  function removeRecipe(id) {
    const list = getAllRecipes();
    const next = list.filter((r) => r.id !== id);
    if (next.length === list.length) return false;
    return safeSet(RECIPES_KEY, JSON.stringify(next));
  }

  /** Importa un respaldo. Acepta un array de recetas o {recipes: [...]}. */
  function importRecipes(jsonText) {
    const data = parseJSON(jsonText, null);
    if (!data) return { ok: false, imported: 0, error: 'El archivo no es un JSON válido.' };

    let incoming = Array.isArray(data) ? data : (Array.isArray(data.recipes) ? data.recipes : null);
    if (!incoming) return { ok: false, imported: 0, error: 'Estructura de respaldo no reconocida.' };

    const current = getAllRecipes();
    const existingIds = new Set(current.map((r) => r.id));
    let added = 0;

    for (const item of incoming) {
      if (!item || typeof item !== 'object' || !item.name) continue;
      const recipe = {
        id: (item.id && !existingIds.has(item.id)) ? item.id : 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 7),
        createdAt: item.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        schema: 1,
        name: String(item.name).slice(0, 60),
        params: item.params || {},
        results: item.results || {},
      };
      if (!existingIds.has(recipe.id)) {
        existingIds.add(recipe.id);
        current.unshift(recipe);
        added++;
      }
    }

    const ok = safeSet(RECIPES_KEY, JSON.stringify(current));
    if (!ok) return { ok: false, imported: 0, error: 'No se pudo escribir el almacenamiento.' };
    return { ok: true, imported: added };
  }

  /** Descarga todas las recetas como archivo .json (funciona offline vía Blob). */
  function exportAllRecipes() {
    const recipes = getAllRecipes();
    const payload = {
      app: 'CAR-SEV C.A. — Calculadora Técnica de Poliuretano',
      exportedAt: new Date().toISOString(),
      recipes,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `carsev-recetas-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return recipes.length;
  }

  /* ============================================================
   * SESIÓN DE TRABAJO (restauración tras recarga del navegador)
   * ============================================================ */

  function saveSession(sessionObject) {
    safeSet(SESSION_KEY, JSON.stringify(sessionObject));
  }

  function loadSession() {
    return parseJSON(safeGet(SESSION_KEY), null);
  }

  return {
    getAllRecipes,
    saveRecipe,
    removeRecipe,
    importRecipes,
    exportAllRecipes,
    saveSession,
    loadSession,
  };
})();