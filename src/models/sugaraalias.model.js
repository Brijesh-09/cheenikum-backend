import mongoose from 'mongoose';

const SugarAliasSchema = new mongoose.Schema({
    alias: { type: String, required: true, unique: true, lowercase: true },
    displayName: { type: String, required: true },
    severity: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
});

export default mongoose.model('SugarAlias', SugarAliasSchema);