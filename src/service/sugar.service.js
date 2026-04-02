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

// ─── AI web search for unknown barcodes ──────────────────────────────────────
// Called only when DB + OFF both return nothing.
// Uses Claude with web_search tool to find real nutrition data from
// company websites, FSSAI listings, or Indian retail pages.
// Result is cached to DB so this never runs twice for the same product.

export const fetchFromAIWebSearch = async (barcode) => {
    try {
        const response = await anthropic.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 1024,
            tools: [{ type: 'web_search_20250305', name: 'web_search' }],
            messages: [
                {
                    role: 'user',
                    content: `Find the nutrition information for the Indian packaged food product with barcode ${barcode}.
Search for the product name, brand, and nutrition facts especially sugar content per 100g.
Look at company websites, FSSAI data, BigBasket, Amazon India, or any Indian retail site.

Return ONLY a JSON object with this exact structure, no extra text:
{
  "found": true or false,
  "name": "product name",
  "brand": "brand name",
  "category": "biscuit|beverage|snack|savory|dairy|other",
  "servingSizeG": 100,
  "sugarPer100g": 0,
  "totalCarbsPer100g": 0,
  "caloriesPer100g": 0,
  "ingredients": ["ingredient1", "ingredient2"]
}

If you cannot find reliable nutrition data for this specific product, return { "found": false }.`,
                },
            ],
        });

        // Extract the final text response which should be our JSON
        const textBlock = response.content.find((b) => b.type === 'text');
        if (!textBlock) return null;

        // Strip any markdown code fences if present
        const clean = textBlock.text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);

        if (!parsed.found || !parsed.name) return null;

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
        console.error('AI web search failed:', err.message);
        return null;
    }
};

// ─── AI Vision — scan nutrition label image ───────────────────────────────────
// Accepts a base64 image of a nutrition panel.
// Claude reads it like a human would — handles any format, angle, language.
// Returns structured nutrition data directly, no regex needed.

export const extractFromLabelImage = async (base64Image, mimeType = 'image/jpeg') => {
    try {
        const response = await anthropic.messages.create({
            model: 'claude-opus-4-5',
            max_tokens: 1024,
            messages: [
                {
                    role: 'user',
                    content: [
                        {
                            type: 'image',
                            source: { type: 'base64', media_type: mimeType, data: base64Image },
                        },
                        {
                            type: 'text',
                            text: `This is a photo of a nutrition label from an Indian packaged food product.
Extract all nutrition information you can see.

Return ONLY a JSON object with this exact structure, no extra text:
{
  "found": true or false,
  "productName": "name if visible on label, else null",
  "sugarPer100g": number,
  "totalCarbsPer100g": number,
  "caloriesPer100g": number,
  "servingSizeG": number or null,
  "ingredients": ["ingredient1", "ingredient2"] or [],
  "confidence": "high|medium|low"
}

If the image is not a nutrition label or values are unreadable, return { "found": false }.`,
                        },
                    ],
                },
            ],
        });

        const textBlock = response.content.find((b) => b.type === 'text');
        if (!textBlock) return null;

        const clean = textBlock.text.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);

        if (!parsed.found) return null;

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
        console.error('AI vision failed:', err.message);
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