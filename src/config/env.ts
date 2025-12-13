import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3001),
  TELEGRAM_BOT_TOKEN: z.string().min(1, 'TELEGRAM_BOT_TOKEN is required'),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(1, 'TELEGRAM_WEBHOOK_SECRET is required'),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
  SUI_RPC_URL: z.string().url('SUI_RPC_URL must be a valid URL'),
  SESSION_SECRET: z.string().min(1, 'SESSION_SECRET is required'),
  WEBHOOK_BASE_URL: z.string().url().optional(),
  USER_SERVICE_URL: z.string().url().default('http://localhost:3005'),
  TX_SERVICE_URL: z.string().url().default('http://localhost:3003'),
  ZKLOGIN_SALT_SERVICE_URL: z.string().url().optional(),
  ZKLOGIN_PROVER_URL: z.string().url().optional(),
  PROVER_URL: z.string().url().optional()
});

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  console.error('❌ Invalid environment configuration', parsedEnv.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsedEnv.data;
export type AppConfig = typeof config;
