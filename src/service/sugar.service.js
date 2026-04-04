import axios from 'axios';
import Anthropic from '@anthropic-ai/sdk';
import Product from '../models/Product.model.js';
import SugarAlias from '../models/sugaraalias.model.js';

const GRAMS_PER_TEASPOON = 4.2;
export const WHO_DAILY_LIMIT_G = 25;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

// ─── Open Food Facts ──────────────────────────────────────────────────────────

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

// ─── Claude web search — unknown barcode lookup ───────────────────────────────
// Uses claude-haiku-4-5 with web_search tool.
// Finds real nutrition data from company sites, BigBasket, Amazon India, FSSAI.
// Result cached to DB — never runs twice for the same product.

export const fetchFromAIWebSearch = async (barcode) => {
  try {
    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [
        {
          role: 'user',
          content: `Find nutrition info for Indian packaged food with barcode ${barcode}.
Search company websites, FSSAI, BigBasket, Amazon India, or any Indian retail site.

Return ONLY this JSON, no markdown, no extra text:
{"found":true,"name":"product name","brand":"brand","category":"biscuit|beverage|snack|savory|dairy|other","servingSizeG":100,"sugarPer100g":0,"totalCarbsPer100g":0,"caloriesPer100g":0,"ingredients":[]}

If not found return: {"found":false}`,
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    if (!textBlock?.text) return null;

    const parsed = safeParseJSON(textBlock.text);
    if (!parsed?.found || !parsed?.name) return null;

    return {
      barcode,
      name: parsed.name,
      brand: parsed.brand || 'Unknown',
      category: parsed.category || 'other',
      servingSize: { value: parsed.servingSizeG || 100, unit: 'g' },
      nutrients: {
        sugarPer100g: parseFloat(parsed.sugarPer100g) || 0,
        totalCarbsPer100g: parseFloat(parsed.totalCarbsPer100g) || 0,
        caloriesPer100g: parseFloat(parsed.caloriesPer100g) || 0,
      },
      ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
      source: 'web_sourced',
    };
  } catch (err) {
    console.error('[fetchFromAIWebSearch] failed:', err.message);
    return null;
  }
};

// ─── Claude Vision — read nutrition label photo ───────────────────────────────
// claude-haiku-4-5 reads the label image directly.
// Handles any format, angle, language — no regex needed.

export const extractFromLabelImage = async (base64Image, mimeType = 'image/jpeg') => {
  try {
    // Claude only accepts jpeg, png, gif, webp
    const supportedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    const safeMimeType = supportedTypes.includes(mimeType) ? mimeType : 'image/jpeg';

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: safeMimeType,
                data: base64Image,
              },
            },
            {
              type: 'text',
              text: `This is a nutrition label from an Indian packaged food product.
Read the nutrition facts panel and return ONLY this JSON, no markdown, no extra text:
{"found":true,"productName":null,"sugarPer100g":0,"totalCarbsPer100g":0,"caloriesPer100g":0,"servingSizeG":100,"ingredients":[],"confidence":"high"}

Rules:
- Replace values with what you read from the label
- Use the per 100g column, not per serving
- confidence: high=clearly readable, medium=partially readable, low=estimated
- If not a nutrition label or unreadable, return: {"found":false}`,
            },
          ],
        },
      ],
    });

    const textBlock = response.content.find((b) => b.type === 'text');
    console.log('[extractFromLabelImage] raw response:', textBlock?.text?.slice(0, 300));

    if (!textBlock?.text) return null;

    const parsed = safeParseJSON(textBlock.text);
    if (!parsed?.found) return null;

    return {
      sugarPer100g: parseFloat(parsed.sugarPer100g) || 0,
      totalCarbsPer100g: parseFloat(parsed.totalCarbsPer100g) || 0,
      caloriesPer100g: parseFloat(parsed.caloriesPer100g) || 0,
      servingSizeG: parsed.servingSizeG || 100,
      productName: parsed.productName || null,
      ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
      confidence: parsed.confidence || 'medium',
    };
  } catch (err) {
    console.error('[extractFromLabelImage] failed:', err.message);
    return null;
  }
};

// ─── Safe JSON parser ─────────────────────────────────────────────────────────

const safeParseJSON = (text) => {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const stripped = text.replace(/```json|```/gi, '').trim();
    try {
      return JSON.parse(stripped);
    } catch {
      const match = stripped.match(/\{[\s\S]*\}/);
      if (match) {
        try { return JSON.parse(match[0]); } catch { return null; }
      }
      return null;
    }
  }
};

// ─── Build unified response ───────────────────────────────────────────────────

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
      dailyLimitStatus: pctDaily <= 40 ? 'low' : pctDaily <= 80 ? 'moderate' : 'high',
    },
    hiddenSugars,
    warning:
      hiddenSugars.length > 0
        ? `Contains ${hiddenSugars.length} hidden sugar source(s)`
        : null,
  };
};