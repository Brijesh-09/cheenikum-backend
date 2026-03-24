import Product from '../models/Product.model.js';
import {
    fetchFromOFF,
    parseLabelText,
    buildResponse,
} from '../service/sugar.service.js';

/**
 * POST /api/scan/barcode
 * Body: { barcode: "8901234567890", servings?: 1 }
 *
 * Flow:
 *   1. Check local DB (pre-seeded Indian snacks + cached products)
 *   2. Try Open Food Facts → cache result
 *   3. If still nothing → 404 with hint to scan label
 */
export const scanBarcode = async (req, res, next) => {
    try {
        const { barcode, servings = 1 } = req.body;
        if (!barcode) return res.status(400).json({ error: 'barcode is required' });

        // 1. Local DB — fastest, seeded Indian snacks live here
        let product = await Product.findOne({ barcode }).lean();

        // 2. Open Food Facts fallback → cache it so next scan is instant
        if (!product) {
            const offData = await fetchFromOFF(barcode);
            if (offData) {
                product = (await Product.create(offData)).toObject();
            }
        }

        // 3. Not found anywhere
        if (!product) {
            return res.status(404).json({
                found: false,
                error: 'Product not found.',
                hint: 'Try scanning the nutrition label directly via POST /api/scan/label',
            });
        }

        return res.json(await buildResponse(product, servings));
    } catch (err) {
        next(err);
    }
};

/**
 * POST /api/scan/label
 * Body: { labelText: "<OCR or raw text from nutrition panel>", servings?: 1 }
 *
 * Used when barcode fails. Client does OCR on the label photo and sends
 * the raw text here. We parse sugar from it and return a lightweight response.
 * No DB write — this is ephemeral.
 *
 * Later: replace labelText with base64 image + call AI vision model.
 */
export const scanLabel = async (req, res, next) => {
    try {
        const { labelText, servings = 1 } = req.body;
        if (!labelText) return res.status(400).json({ error: 'labelText is required' });

        const parsed = parseLabelText(labelText);

        if (!parsed) {
            return res.status(422).json({
                found: false,
                error: 'Could not extract sugar from label text.',
                hint: 'Ensure the text includes sugar content, e.g. "Sugars 17g"',
            });
        }

        const { gramToTeaspoon, WHO_DAILY_LIMIT_G } = await import('../services/sugar.service.js');

        // Build a lightweight ephemeral product object (not saved to DB)
        const sugarGrams = parseFloat(((parsed.sugarPer100g / 100) * 100 * servings).toFixed(2));
        const sugarTeaspoons = gramToTeaspoon(sugarGrams);
        const pctDaily = parseFloat(((sugarGrams / WHO_DAILY_LIMIT_G) * 100).toFixed(1));

        return res.json({
            found: true,
            product: { name: 'Unknown product', brand: 'Unknown', source: 'label_parse' },
            sugar: {
                per100g: parsed.sugarPer100g,
                perServing: { grams: sugarGrams, teaspoons: sugarTeaspoons, servings, servingSizeG: 100 },
                dailyLimitPct: pctDaily,
                dailyLimitStatus: pctDaily <= 40 ? 'low' : pctDaily <= 80 ? 'moderate' : 'high',
            },
            hiddenSugars: [],
            warning: null,
            note: 'Parsed from label text. Accuracy depends on OCR quality.',
        });
    } catch (err) {
        next(err);
    }
};