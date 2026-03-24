import mongoose from 'mongoose';

const ProductSchema = new mongoose.Schema(
    {
        barcode: { type: String, required: true, unique: true, index: true },
        name: { type: String, required: true },
        brand: { type: String, default: 'Unknown' },
        category: {
            type: String,
            enum: ['biscuit', 'beverage', 'snack', 'savory', 'dairy', 'other'],
            default: 'other',
        },
        servingSize: {
            value: { type: Number, default: 100 },
            unit: { type: String, default: 'g' },
        },
        nutrients: {
            sugarPer100g: { type: Number, required: true },
            totalCarbsPer100g: { type: Number, default: 0 },
            caloriesPer100g: { type: Number, default: 0 },
        },
        ingredients: [String],
        // 'verified' = manually seeded Indian snacks (most trustworthy)
        // 'openfoodfacts' = fetched + cached from OFF
        source: {
            type: String,
            enum: ['verified', 'openfoodfacts'],
            default: 'openfoodfacts',
        },
    },
    { timestamps: true }
);

export default mongoose.model('Product', ProductSchema);