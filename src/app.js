import 'dotenv/config';
import express from 'express';
import { connectDB } from './config/db.js';
import scanRoutes from './routes/scan.routes.js';

const app = express();
app.use(express.json({ limit: '10mb' })); // allow base64 label photos

app.use('/api/scan', scanRoutes);

app.get('/health', (_, res) => res.json({ status: 'ok' }));

app.use((_, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Server error' });
});

const PORT = process.env.PORT || 3000;
connectDB().then(() =>
    app.listen(PORT, () => console.log(`🚀 Running on port ${PORT}`))
);