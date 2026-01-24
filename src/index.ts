import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import authRouter from './auth/router';
import eventsRouter from './events/router';
import seatsRouter from './seats/router';
import { initializeSocket } from './lib/socket';

const app = express();

app.use(express.json());

app.use(cors());

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/events", eventsRouter);
app.use("/api/v1/seats", seatsRouter);

app.get('/', (req, res) => {
    res.send('Backend is running');
});

app.use((err: Error, req: express.Request, res: express.Response) => {
    return res
      .status(400)
      .json({ error: { message: err.message || "something went wrong" } });
  });

// Create HTTP server
const httpServer = createServer(app);

// Initialize Socket.IO
initializeSocket(httpServer);

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Socket.IO server initialized`);
});