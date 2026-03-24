import 'dotenv/config';
import mongoose from 'mongoose';
import SugarAlias from '../src/models/SugarAlias.model.js';

const aliases = [
    { alias: 'high fructose corn syrup', displayName: 'High-fructose corn syrup', severity: 'high' },
    { alias: 'corn syrup', displayName: 'Corn syrup', severity: 'high' },
    { alias: 'glucose syrup', displayName: 'Glucose syrup', severity: 'high' },
    { alias: 'fructose', displayName: 'Fructose', severity: 'high' },
    { alias: 'invert sugar', displayName: 'Invert sugar', severity: 'high' },
    { alias: 'sucrose', displayName: 'Sucrose', severity: 'medium' },
    { alias: 'dextrose', displayName: 'Dextrose', severity: 'medium' },
    { alias: 'maltose', displayName: 'Maltose', severity: 'medium' },
    { alias: 'malt syrup', displayName: 'Malt syrup', severity: 'medium' },
    { alias: 'barley malt', displayName: 'Barley malt', severity: 'medium' },
    { alias: 'rice syrup', displayName: 'Rice syrup', severity: 'medium' },
    { alias: 'brown rice syrup', displayName: 'Brown rice syrup', severity: 'medium' },
    { alias: 'agave', displayName: 'Agave nectar', severity: 'medium' },
    { alias: 'honey', displayName: 'Honey', severity: 'medium' },
    { alias: 'golden syrup', displayName: 'Golden syrup', severity: 'medium' },
    { alias: 'caramel', displayName: 'Caramel', severity: 'medium' },
    { alias: 'treacle', displayName: 'Treacle', severity: 'medium' },
    { alias: 'molasses', displayName: 'Molasses', severity: 'medium' },
    // Indian-specific
    { alias: 'jaggery', displayName: 'Jaggery (Gur)', severity: 'medium' },
    { alias: 'khandsari', displayName: 'Khandsari sugar', severity: 'medium' },
    { alias: 'mishri', displayName: 'Mishri (rock sugar)', severity: 'medium' },
    { alias: 'bura', displayName: 'Bura (powdered sugar)', severity: 'medium' },
    { alias: 'shakkar', displayName: 'Shakkar', severity: 'medium' },
    { alias: 'cane sugar', displayName: 'Cane sugar', severity: 'medium' },
    { alias: 'raw sugar', displayName: 'Raw sugar', severity: 'medium' },
    { alias: 'coconut sugar', displayName: 'Coconut sugar', severity: 'low' },
    // "Natural" sugars people don't suspect
    { alias: 'fruit juice concentrate', displayName: 'Fruit juice concentrate', severity: 'low' },
    { alias: 'apple juice concentrate', displayName: 'Apple juice concentrate', severity: 'low' },
    { alias: 'grape juice concentrate', displayName: 'Grape juice concentrate', severity: 'low' },
    { alias: 'date syrup', displayName: 'Date syrup', severity: 'low' },
    { alias: 'evaporated cane juice', displayName: 'Evaporated cane juice', severity: 'medium' },
    { alias: 'demerara', displayName: 'Demerara sugar', severity: 'medium' },
    { alias: 'muscovado', displayName: 'Muscovado sugar', severity: 'medium' },
];

async function seed() {
    await mongoose.connect(process.env.MONGO_URI);
    let added = 0, skipped = 0;
    for (const a of aliases) {
        try { await SugarAlias.create(a); added++; }
        catch (e) { if (e.code === 11000) skipped++; else throw e; }
    }
    console.log(`✅ Aliases: ${added} added, ${skipped} skipped`);
    await mongoose.disconnect();
}

seed().catch((e) => { console.error(e); process.exit(1); });