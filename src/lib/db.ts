import pgPromise from "pg-promise";
import dotenv from "dotenv";

dotenv.config();


const DATABASE_URL = process.env.DATABASE_URL;
const NODE_ENV = process.env.NODE_ENV;

const pgp = pgPromise();

const dbConfig = {
  connectionString: DATABASE_URL,
  ssl: NODE_ENV === "Production" ? { rejectUnauthorized: false } : false,
};

const db = pgp(dbConfig);

export default db;