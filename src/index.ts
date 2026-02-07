import express from 'express';
import { createServer } from 'http';
import cors from 'cors';
import authRouter from './auth/router';
import eventsRouter from './events/router';
import seatsRouter from './seats/router';
import bookingsRouter from './bookings/router';
import paymentsRouter from './payments/router';
import { initializeSocket } from './lib/socket';
import { startCleanupJobs, stopCleanupJobs } from './lib/jobs/cleanupJobs';
import { startTicketQueue, stopTicketQueue } from './lib/jobs/ticketQueue';

const app = express();

// Middleware for raw body (needed for webhook signature verification)
// Must be before express.json() middleware
app.use('/api/v1/payments/webhook', express.raw({ type: 'application/json' }));

app.use(express.json());

app.use(cors());

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/events", eventsRouter);
app.use("/api/v1/seats", seatsRouter);
app.use("/api/v1/bookings", bookingsRouter);
app.use("/api/v1/payments", paymentsRouter);

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

    // Start BullMQ queues after server is ready
    startCleanupJobs().catch((err) => {
        console.error("⚠️ Failed to start cleanup jobs:", err.message);
    });
    startTicketQueue().catch((err) => {
        console.error("⚠️ Failed to start ticket queue:", err.message);
    });
});

// ── Graceful shutdown ──
const gracefulShutdown = async (signal: string) => {
    console.log(`\n🛑 ${signal} received — shutting down gracefully...`);
    try {
        await stopTicketQueue();
        await stopCleanupJobs();
    } catch (err) {
        console.error("⚠️ Error stopping queues:", err);
    }
    httpServer.close(() => {
        console.log("👋 Server closed");
        process.exit(0);
    });
    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => process.exit(1), 10_000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));