// Vercel serverless entry. vercel.json rewrites /api/(.*) here; req.url keeps the original path.
import { handler } from '../src/app.js';

export default handler;
