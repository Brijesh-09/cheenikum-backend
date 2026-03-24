import axios from 'axios';
import Product from '../models/Product.model.js';
import SugarAlias from '../models/sugaraalias.model.js';

const GRAMS_PER_TEASPOON = 4.2;
export const WHO_DAILY_LIMIT_G = 25;

// ─── Converters ───────────────────────────────────────────────────────────────

export const gramToTeaspoon = (g) => parseFloat((g / GRAMS_PER_TEASPOON).toFixed(2));

export const computeSugar = (product, servings = 1) => {
    const g = (product.nutrients.sugarPer100g / 100) * product.servingSize.value * servings;
    return {
        sugarGrams: parseFloat(g.toFixed(2)),
        sugarTeaspoons: gramToTeaspoon(g),
    };
};

// ─── Hidden sugar detection ───────────────────────────────────────────────────

export const detectHiddenSugars = async (ingredients = []) => {
    if (!ingredients.length) return [];
    const aliases = await SugarAlias.find().lean();
    const lower = ingredients.map((i) => i.toLowerCase());
    return aliases
        .filter((a) => lower.some((ing) => ing.includes(a.alias)))
        .map((a) => ({ name: a.displayName, severity: a.severity }));
};

// ─── Open Food Facts fetch + normalise ───────────────────────────────────────

export const fetchFromOFF = async (barcode) => {
    try {
        const { data } = await axios.get(
            `https://world.openfoodfacts.org/api/v0/product/${barcode}.json`,
            { timeout: 6000 }
        );
        if (data.status !== 1 || !data.product) return null;

        const p = data.product;
        const n = p.nutriments || {};

        return {
            barcode,
            name: p.product_name || p.product_name_en || 'Unknown product',
            brand: p.brands || 'Unknown',
            category: mapCategory(p.categories_tags || []),
            servingSize: {
                value: parseFloat(p.serving_quantity) || 100,
                unit: 'g',
            },
            nutrients: {
                sugarPer100g: parseFloat(n['sugars_100g']) || 0,
                totalCarbsPer100g: parseFloat(n['carbohydrates_100g']) || 0,
                caloriesPer100g: parseFloat(n['energy-kcal_100g']) || 0,
            },
            ingredients: p.ingredients_text
                ? p.ingredients_text.split(',').map((s) => s.trim())
                : [],
            source: 'openfoodfacts',
        };
    } catch {
        return null;
    }
};

const mapCategory = (tags) => {
    const s = tags.join(' ').toLowerCase();
    if (s.includes('biscuit') || s.includes('cookie')) return 'biscuit';
    if (s.includes('beverage') || s.includes('drink') || s.includes('juice')) return 'beverage';
    if (s.includes('dairy') || s.includes('milk') || s.includes('yogurt')) return 'dairy';
    if (s.includes('snack') || s.includes('chips') || s.includes('namkeen')) return 'snack';
    if (s.includes('savour') || s.includes('namkeen') || s.includes('mixture')) return 'savory';
    return 'other';
};

// ─── Parse nutrition label image (base64) ────────────────────────────────────
// Called when barcode lookup fails entirely.
// Parses the label text client sends (OCR output or raw text) to extract sugar.

export const parseLabelText = (text) => {
    if (!text) return null;

    // Normalise: lowercase, collapse whitespace
    const s = text.toLowerCase().replace(/\s+/g, ' ');

    // Try to extract sugar per 100g — handles formats like:
    //   "sugars 17g", "sugar 17.5 g", "total sugars 17 g per 100g"
    const patterns = [
        /(?:total\s+)?sugars?\s*[:\-]?\s*(\d+(?:\.\d+)?)\s*g/,
        /sugar\s+(\d+(?:\.\d+)?)/,
    ];

    for (const re of patterns) {
        const m = s.match(re);
        if (m) {
            return {
                sugarPer100g: parseFloat(m[1]),
                source: 'label_parse',
            };
        }
    }

    return null;
};

// ─── Build the unified response shape ─────────────────────────────────────────

export const buildResponse = async (product, servings) => {
    const { sugarGrams, sugarTeaspoons } = computeSugar(product, servings);
    const hiddenSugars = await detectHiddenSugars(product.ingredients);
    const pctDaily = parseFloat(((sugarGrams / WHO_DAILY_LIMIT_G) * 100).toFixed(1));

    return {
        found: true,
        product: {
            name: product.name,
            brand: product.brand,
            category: product.category,
            source: product.source,
        },
        sugar: {
            per100g: product.nutrients.sugarPer100g,
            perServing: {
                grams: sugarGrams,
                teaspoons: sugarTeaspoons,
                servings,
                servingSizeG: product.servingSize.value,
            },
            dailyLimitPct: pctDaily,
            dailyLimitStatus:
                pctDaily <= 40 ? 'low' : pctDaily <= 80 ? 'moderate' : 'high',
        },
        hiddenSugars,
        warning:
            hiddenSugars.length > 0
                ? `Contains ${hiddenSugars.length} hidden sugar source(s)`
                : null,
    };
};