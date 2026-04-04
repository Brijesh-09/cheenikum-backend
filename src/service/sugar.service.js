import axios from 'axios';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Product from '../models/Product.model.js';
import SugarAlias from '../models/sugaraalias.model.js';

const GRAMS_PER_TEASPOON = 4.2;
export const WHO_DAILY_LIMIT_G = 25;
 
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
 
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
 
// ─── Shared JSON parser — handles markdown fences, extracts first JSON block ──
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
 
// ─── Gemini web search — unknown barcode lookup ───────────────────────────────
// Uses Gemini 2.0 Flash with Google Search grounding.
// Finds real nutrition data from company sites, BigBasket, Amazon India, FSSAI.
// Result is cached to DB — this call never runs twice for the same product.
 
export const fetchFromAIWebSearch = async (barcode) => {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash-8b',
      tools: [{ googleSearch: {} }],
    });
 
    const prompt = `Search and find the nutrition information for the Indian packaged food product with barcode ${barcode}.
Look at company websites, FSSAI data, BigBasket, Amazon India, Flipkart, or any Indian retail/grocery site.
Find the product name, brand, and nutrition facts especially sugar content per 100g.
 
Return ONLY a valid JSON object, no markdown, no explanation:
{
  "found": true,
  "name": "product name",
  "brand": "brand name",
  "category": "biscuit|beverage|snack|savory|dairy|other",
  "servingSizeG": 100,
  "sugarPer100g": 0,
  "totalCarbsPer100g": 0,
  "caloriesPer100g": 0,
  "ingredients": ["ingredient1", "ingredient2"]
}
 
If you cannot find reliable nutrition data for this exact product, return: {"found": false}`;
 
    const result = await model.generateContent(prompt);
 
    const text =
      result?.response?.text?.() ||
      result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      '';
 
    if (!text) return null;
 
    const parsed = safeParseJSON(text);
    if (!parsed || !parsed.found || !parsed.name) return null;
 
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
    console.error('Gemini web search failed:', err.message);
    return null;
  }
};
 
// ─── Gemini Vision — read nutrition label photo ───────────────────────────────
// Accepts a base64 image of a nutrition panel.
// Gemini 1.5 Flash reads it like a human — handles any format, angle, language.
// Returns structured nutrition data directly.
 
export const extractFromLabelImage = async (base64Image, mimeType = 'image/jpeg') => {
  try {
    const model = genAI.getGenerativeModel({
      model: 'gemini-1.5-flash-8b',
    });
 
    const imagePart = {
      inlineData: { data: base64Image, mimeType },
    };
 
    const prompt = `Look at this nutrition label image from an Indian packaged food product.
Extract the nutrition values and return ONLY this JSON, nothing else, no markdown:
{"found":true,"productName":null,"sugarPer100g":0,"totalCarbsPer100g":0,"caloriesPer100g":0,"servingSizeG":100,"ingredients":[],"confidence":"high"}
 
Replace the values with what you read from the label. Use per 100g column.
If you cannot read the label clearly, return exactly: {"found":false}`;
 
    const result = await model.generateContent([prompt, imagePart]);
 
    // Safely extract text — handle both response shapes
    const text =
      result?.response?.text?.() ||
      result?.response?.candidates?.[0]?.content?.parts?.[0]?.text ||
      '';
 
    console.log('[extractFromLabelImage] raw Gemini response:', text?.slice(0, 500));
 
    if (!text) {
      console.error('Gemini vision: empty response');
      return null;
    }
 
    const parsed = safeParseJSON(text);
    if (!parsed || !parsed.found) return null;
 
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
    console.error('Gemini vision failed:', err.message);
    return null;
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
 