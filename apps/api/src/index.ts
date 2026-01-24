import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// API routes
app.get('/api/v1/startups', async (req, res) => {
  // TODO: Implement startup listing with PostgreSQL
  res.json({ message: 'Startups endpoint - coming soon' });
});

app.get('/api/v1/stats', async (req, res) => {
  // TODO: Implement stats aggregation
  res.json({ message: 'Stats endpoint - coming soon' });
});

app.listen(PORT, () => {
  console.log(`API server running on port ${PORT}`);
});

export default app;
