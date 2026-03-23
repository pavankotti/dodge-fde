require('dotenv').config();
const express = require('express');
const cors = require('cors');
const graphRoutes = require('./routes/graph');
const chatRoutes = require('./routes/chat');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/graph', graphRoutes);
app.use('/api/chat', chatRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Backend running on http://localhost:${PORT}`));