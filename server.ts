import express from 'express';
import path from 'path';
import dotenv from 'dotenv';
import { analyzePlateAndStudent } from './server/geminiService';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    hasGeminiKey: Boolean(process.env.GEMINI_API_KEY),
  });
});

// Plate & student analysis
app.post('/api/analyze-plate', async (req, res) => {
  try {
    const { capturedPhoto, candidates } = req.body;
    if (!capturedPhoto) {
      return res.status(400).json({ error: 'Missing capturedPhoto' });
    }
    const result = await analyzePlateAndStudent(capturedPhoto, candidates || []);
    res.json(result);
  } catch (err: any) {
    console.error('Server analyze error:', err);
    res.status(500).json({
      error: err?.message || 'Server analysis error',
      matches: [],
      waste_level: 'Medium',
      reason: 'Failed to complete AI analysis.',
    });
  }
});

// Serve static frontend in production
app.use(express.static(path.resolve(__dirname, 'dist')));

app.get('*', (req, res) => {
  res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`NNF Mess Staff server running on port ${PORT}`);
});
