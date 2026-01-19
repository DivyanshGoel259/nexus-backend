import express from 'express';
import cors from 'cors';
import authRouter from './auth/router';

const app = express();

app.use(express.json());

app.use(cors());

app.use("/api/v1/auth",authRouter);

app.get('/', (req, res) => {
    res.send('Backend is running');
});

app.use((err: Error, req: express.Request, res: express.Response) => {
    return res
      .status(400)
      .json({ error: { message: err.message || "something went wrong" } });
  });



app.listen(3000, () => {
    console.log('Server is running on port 3000');
});