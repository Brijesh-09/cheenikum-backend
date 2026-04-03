import Product from '../models/Product.model.js';
import {
    fetchFromOFF,
    fetchFromAIWebSearch,
    extractFromLabelImage,
    buildResponse,
    gramToTeaspoon,
    WHO_DAILY_LIMIT_G,
    detectHiddenSugars,
} from '../service/sugar.service.js';

// ─── Barcode normalisation ────────────────────────────────────────────────────
const normaliseBarcode = (raw) => {
    const b = String(raw).trim().replace(/\s/g, '');
    const candidates = [b];
    if (b.length === 12 && /^\d+$/.test(b)) candidates.push('0' + b);
    if (b.length === 14 && b.startsWith('0')) candidates.push(b.slice(1));
    return candidates;
};

// ─── POST /api/scan/barcode ───────────────────────────────────────────────────
// Flow: DB → Open Food Facts → AI web search → 404
export const scanBarcode = async (req, res, next) => {
    try {
        const { barcode: rawBarcode, servings = 1 } = req.body;
        if (!rawBarcode) return res.status(400).json({ error: 'barcode is required' });

        const candidates = normaliseBarcode(rawBarcode);

        // 1. Local DB
        let product = await Product.findOne({ barcode: { $in: candidates } }).lean();

        // 2. Open Food Facts
        if (!product) {
            for (const candidate of candidates) {
                const offData = await fetchFromOFF(candidate);
                if (!offData) continue;
                product = await Product.findOneAndUpdate(
                    { barcode: offData.barcode },
                    { $setOnInsert: offData },
                    { upsert: true, new: true, lean: true }
                );
                break;
            }
        }

        // 3. AI web search — finds real data from company sites, caches permanently
        if (!product) {
            const aiData = await fetchFromAIWebSearch(candidates[0]);
            if (aiData) {
                product = await Product.findOneAndUpdate(
                    { barcode: aiData.barcode },
                    { $setOnInsert: aiData },
                    { upsert: true, new: true, lean: true }
                );
            }
        }

        // 4. Nothing found anywhere
        if (!product) {
            return res.status(404).json({
                found: false,
                error: 'Product not found anywhere.',
                hint: 'Scan the nutrition label on the pack for instant results.',
            });
        }

        return res.json(await buildResponse(product, Number(servings)));
    } catch (err) {
        next(err);
    }
};

// ─── POST /api/scan/label ─────────────────────────────────────────────────────
// Primary flow: user photographs the nutrition label.
// Claude Vision reads the label image and extracts all values.
// Body: { imageBase64: "...", mimeType?: "image/jpeg", servings?: 1 }
export const scanLabel = async (req, res, next) => {
    try {
        const { imageBase64, mimeType = 'image/jpeg', servings = 1 } = req.body;

        console.log(`[scanLabel] mimeType: ${mimeType}, servings: ${servings}, base64 length: ${imageBase64?.length || 0}`);

        if (!imageBase64) {
            return res.status(400).json({ error: 'imageBase64 is required' });
        }

        if (imageBase64.length < 100) {
            return res.status(400).json({ error: 'Image data is empty. Please try taking the photo again.' });
        }

        const extracted = await extractFromLabelImage(imageBase64, mimeType);
        console.log('[scanLabel] Gemini result:', JSON.stringify(extracted));

        if (!extracted) {
            return res.status(422).json({
                found: false,
                error: 'Could not read nutrition values from this image.',
                hint: 'Make sure the photo is of the nutrition facts panel, well-lit and in focus.',
            });
        }

        const numServings = Number(servings);
        const servingSizeG = extracted.servingSizeG || 100;
        const rawGrams = (extracted.sugarPer100g / 100) * servingSizeG * numServings;
        const sugarGrams = parseFloat(rawGrams.toFixed(2));
        const sugarTeaspoons = gramToTeaspoon(sugarGrams);
        const pctDaily = parseFloat(((sugarGrams / WHO_DAILY_LIMIT_G) * 100).toFixed(1));

        // Run hidden sugar detection on extracted ingredients if available
        const hiddenSugars = await detectHiddenSugars(extracted.ingredients || []);

        return res.json({
            found: true,
            product: {
                name: extracted.productName || 'Scanned product',
                brand: 'From label',
                category: 'other',
                source: 'label_scan',
            },
            sugar: {
                per100g: extracted.sugarPer100g,
                perServing: {
                    grams: sugarGrams,
                    teaspoons: sugarTeaspoons,
                    servings: numServings,
                    servingSizeG,
                },
                dailyLimitPct: pctDaily,
                dailyLimitStatus: pctDaily <= 40 ? 'low' : pctDaily <= 80 ? 'moderate' : 'high',
                totalCarbs: extracted.totalCarbsPer100g,
                calories: extracted.caloriesPer100g,
            },
            hiddenSugars,
            warning: hiddenSugars.length > 0
                ? `Contains ${hiddenSugars.length} hidden sugar source(s)`
                : null,
            confidence: extracted.confidence,
            note: extracted.confidence === 'low'
                ? 'Low confidence read — verify values on the pack.'
                : null,
        });
    } catch (err) {
        next(err);
    }
};