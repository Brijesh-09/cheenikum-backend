import { Router } from 'express';

import { scanBarcode, scanLabel } from '../controller/scan.controller.js';

const router = Router();

router.post('/barcode', scanBarcode);  // primary: barcode scan
router.post('/label', scanLabel);      // fallback: nutrition label OCR text

export default router;