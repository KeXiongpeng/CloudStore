import * as Joi from 'joi';

export const configuration = () => ({
  database: {
    url: process.env.DATABASE_URL,
  },
  redis: {
    host: process.env.REDIS_HOST || 'redis',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  jwt: {
    secret: process.env.JWT_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessTokenTtl: 15 * 60,       // 15 minutes
    refreshTokenTtl: 7 * 24 * 60 * 60, // 7 days
  },
  qiniu: {
    accessKey: process.env.QINIU_ACCESS_KEY,
    secretKey: process.env.QINIU_SECRET_KEY,
    bucket: process.env.QINIU_BUCKET,
    endpoint: process.env.QINIU_ENDPOINT,
    cdnDomain: process.env.QINIU_CDN_DOMAIN,
  },
  cors: {
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'admin123456',
  },
});

export const configValidationSchema = Joi.object({
  DATABASE_URL: Joi.string().required(),
  REDIS_HOST: Joi.string().default('redis'),
  REDIS_PORT: Joi.number().default(6379),
  JWT_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  QINIU_ACCESS_KEY: Joi.string().optional().default('dev-access-key'),
  QINIU_SECRET_KEY: Joi.string().optional().default('dev-secret-key'),
  QINIU_BUCKET: Joi.string().optional().default('dev-bucket'),
  QINIU_ENDPOINT: Joi.string().optional().default('https://s3.cn-east-1.qiniu.com'),
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),
  GITHUB_CLIENT_ID: Joi.string().optional(),
  GITHUB_CLIENT_SECRET: Joi.string().optional(),
  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),
  ADMIN_EMAIL: Joi.string().default('admin@example.com'),
  ADMIN_PASSWORD: Joi.string().default('admin123456'),
});
