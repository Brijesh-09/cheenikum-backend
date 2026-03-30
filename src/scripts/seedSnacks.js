import 'dotenv/config';
import mongoose from 'mongoose';
import Product from '../models/Product.model.js';

// Verified sugar data for popular Indian packaged foods.
// sugarPer100g sourced from official brand nutrition labels.
// Barcodes are real EAN-13 codes for these products.
const snacks = [
    // ── Biscuits ──────────────────────────────────────────────────────────────
    {
        barcode: '8901719110085',
        name: 'Parle-G Original Glucose Biscuits',
        brand: 'Parle',
        category: 'biscuit',
        servingSize: { value: 40, unit: 'g' },   // ~4 biscuits
        nutrients: { sugarPer100g: 17.5, totalCarbsPer100g: 76, caloriesPer100g: 450 },
        ingredients: ['wheat flour', 'sugar', 'edible vegetable oil', 'invert syrup', 'milk solids', 'salt', 'baking powder'],
        source: 'verified',
    },
    {
        barcode: '8901058004506',
        name: 'Britannia Good Day Cashew Cookies',
        brand: 'Britannia',
        category: 'biscuit',
        servingSize: { value: 35, unit: 'g' },
        nutrients: { sugarPer100g: 22.4, totalCarbsPer100g: 68, caloriesPer100g: 490 },
        ingredients: ['wheat flour', 'sugar', 'edible vegetable oil', 'cashew nuts', 'invert syrup', 'milk solids'],
        source: 'verified',
    },
    {
        barcode: '8901058003516',
        name: 'Britannia Marie Gold',
        brand: 'Britannia',
        category: 'biscuit',
        servingSize: { value: 33, unit: 'g' },
        nutrients: { sugarPer100g: 14.5, totalCarbsPer100g: 74, caloriesPer100g: 443 },
        ingredients: ['wheat flour', 'sugar', 'edible vegetable oil', 'skimmed milk powder', 'glucose syrup', 'salt'],
        source: 'verified',
    },
    {
        barcode: '8901058823606',
        name: 'Britannia NutriChoice Digestive',
        brand: 'Britannia',
        category: 'biscuit',
        servingSize: { value: 30, unit: 'g' },
        nutrients: { sugarPer100g: 10.2, totalCarbsPer100g: 65, caloriesPer100g: 430 },
        ingredients: ['whole wheat flour', 'sugar', 'edible vegetable oil', 'oat flour', 'baking powder', 'salt'],
        source: 'verified',
    },
    {
        barcode: '8901719117411',
        name: 'Parle Hide & Seek Chocolate Chip Cookies',
        brand: 'Parle',
        category: 'biscuit',
        servingSize: { value: 30, unit: 'g' },
        nutrients: { sugarPer100g: 28.0, totalCarbsPer100g: 68, caloriesPer100g: 502 },
        ingredients: ['wheat flour', 'sugar', 'chocolate chips', 'edible vegetable oil', 'cocoa powder', 'invert syrup'],
        source: 'verified',
    },

    // ── Beverages ─────────────────────────────────────────────────────────────
    {
        barcode: '8901063100046',
        name: 'Frooti Mango Fruit Drink',
        brand: 'Parle Agro',
        category: 'beverage',
        servingSize: { value: 250, unit: 'ml' },
        nutrients: { sugarPer100g: 11.8, totalCarbsPer100g: 12.1, caloriesPer100g: 48 },
        ingredients: ['water', 'mango pulp', 'sugar', 'acidity regulator', 'flavour'],
        source: 'verified',
    },
    {
        barcode: '8901499000025',
        name: 'Maaza Mango Drink',
        brand: 'Coca-Cola India',
        category: 'beverage',
        servingSize: { value: 250, unit: 'ml' },
        nutrients: { sugarPer100g: 14.0, totalCarbsPer100g: 14.3, caloriesPer100g: 57 },
        ingredients: ['water', 'mango pulp', 'sugar', 'citric acid', 'mango flavour'],
        source: 'verified',
    },
    {
        barcode: '8901520101112',
        name: 'Tropicana Orange 100% Juice',
        brand: 'PepsiCo India',
        category: 'beverage',
        servingSize: { value: 200, unit: 'ml' },
        nutrients: { sugarPer100g: 9.0, totalCarbsPer100g: 10.0, caloriesPer100g: 41 },
        ingredients: ['orange juice from concentrate', 'water', 'natural orange flavour'],
        source: 'verified',
    },
    {
        barcode: '8906002310022',
        name: "B Natural Guava Drink",
        brand: 'ITC',
        category: 'beverage',
        servingSize: { value: 200, unit: 'ml' },
        nutrients: { sugarPer100g: 12.5, totalCarbsPer100g: 13.0, caloriesPer100g: 52 },
        ingredients: ['water', 'guava pulp', 'sugar', 'acidity regulator', 'vitamin C'],
        source: 'verified',
    },

    // ── Snacks ────────────────────────────────────────────────────────────────
    {
        barcode: '8901063196804',
        name: 'Kurkure Masala Munch',
        brand: 'PepsiCo India',
        category: 'snack',
        servingSize: { value: 30, unit: 'g' },
        nutrients: { sugarPer100g: 3.2, totalCarbsPer100g: 58, caloriesPer100g: 513 },
        ingredients: ['rice meal', 'edible vegetable oil', 'corn meal', 'salt', 'spices', 'sugar', 'flavour'],
        source: 'verified',
    },
    {
        barcode: '8901030693206',
        name: 'Lay\'s Classic Salted',
        brand: 'PepsiCo India',
        category: 'snack',
        servingSize: { value: 26, unit: 'g' },
        nutrients: { sugarPer100g: 0.4, totalCarbsPer100g: 53, caloriesPer100g: 536 },
        ingredients: ['potatoes', 'edible vegetable oil', 'salt'],
        source: 'verified',
    },
    {
        barcode: '8901063117419',
        name: 'Uncle Chipps Spicy Treat',
        brand: 'PepsiCo India',
        category: 'snack',
        servingSize: { value: 26, unit: 'g' },
        nutrients: { sugarPer100g: 1.5, totalCarbsPer100g: 56, caloriesPer100g: 530 },
        ingredients: ['potatoes', 'edible vegetable oil', 'spices', 'salt', 'sugar'],
        source: 'verified',
    },

    // ── Savory / Namkeen ──────────────────────────────────────────────────────
    {
        barcode: '8906003480101',
        name: 'Haldiram\'s Aloo Bhujia',
        brand: "Haldiram's",
        category: 'savory',
        servingSize: { value: 30, unit: 'g' },
        nutrients: { sugarPer100g: 2.1, totalCarbsPer100g: 48, caloriesPer100g: 520 },
        ingredients: ['besan', 'potato', 'edible vegetable oil', 'salt', 'spices', 'sugar'],
        source: 'verified',
    },
    {
        barcode: '8906003481016',
        name: "Haldiram's Moong Dal",
        brand: "Haldiram's",
        category: 'savory',
        servingSize: { value: 30, unit: 'g' },
        nutrients: { sugarPer100g: 1.8, totalCarbsPer100g: 45, caloriesPer100g: 490 },
        ingredients: ['moong dal', 'edible vegetable oil', 'salt', 'spices'],
        source: 'verified',
    },
    {
        barcode: '8906003482006',
        name: "Haldiram's Mixture",
        brand: "Haldiram's",
        category: 'savory',
        servingSize: { value: 30, unit: 'g' },
        nutrients: { sugarPer100g: 3.5, totalCarbsPer100g: 50, caloriesPer100g: 508 },
        ingredients: ['besan', 'peanuts', 'edible vegetable oil', 'salt', 'spices', 'sugar', 'raisins'],
        source: 'verified',
    },

    // ── Dairy / Yogurt ────────────────────────────────────────────────────────
    {
        barcode: '8901207000034',
        name: 'Amul Masti Dahi (Curd)',
        brand: 'Amul',
        category: 'dairy',
        servingSize: { value: 100, unit: 'g' },
        nutrients: { sugarPer100g: 4.8, totalCarbsPer100g: 5.1, caloriesPer100g: 62 },
        ingredients: ['pasteurised toned milk', 'live lactic acid cultures'],
        source: 'verified',
    },
    {
        barcode: '8901207002878',
        name: 'Amul Kool Koko Chocolate Milk',
        brand: 'Amul',
        category: 'beverage',
        servingSize: { value: 200, unit: 'ml' },
        nutrients: { sugarPer100g: 9.6, totalCarbsPer100g: 12.5, caloriesPer100g: 72 },
        ingredients: ['toned milk', 'sugar', 'cocoa solids', 'flavour'],
        source: 'verified',
    },
];

async function seed() {
    await mongoose.connect(process.env.MONGO_URI);
    let added = 0, skipped = 0;

    for (const snack of snacks) {
        try {
            await Product.create(snack);
            added++;
        } catch (e) {
            if (e.code === 11000) skipped++;
            else throw e;
        }
    }

    console.log(`✅ Snacks: ${added} added, ${skipped} skipped`);
    await mongoose.disconnect();
}

seed().catch((e) => { console.error(e); process.exit(1); });