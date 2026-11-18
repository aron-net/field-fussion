import { defineConfig } from 'drizzle-kit';
import * as dotenv from 'dotenv';
import { resolveDatabaseConfig } from './connection.ts';

dotenv.config();

const dbConfig = resolveDatabaseConfig({ admin: true });

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  schemaFilter: ['public'],
  extensionsFilters: ['postgis'],
  dbCredentials: {
    host: dbConfig.host,
    ...(dbConfig.port ? { port: dbConfig.port } : {}),
    ...(dbConfig.user ? { user: dbConfig.user } : {}),
    ...(dbConfig.password ? { password: dbConfig.password } : {}),
    database: dbConfig.database,
    ssl: dbConfig.ssl,
  },
  verbose: true,
});
