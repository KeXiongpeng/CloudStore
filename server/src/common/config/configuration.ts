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
    accessTokenTtl: 15 * 60,
    refreshTokenTtl: 7 * 24 * 60 * 60,
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
  app: {
    url: process.env.APP_URL || process.env.FRONTEND_URL || 'http://localhost:3001',
    frontendUrl: process.env.FRONTEND_URL || process.env.APP_URL || 'http://localhost:3001',
  },
  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    redirectUri: process.env.GITHUB_REDIRECT_URI,
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  },
  wechat: {
    clientId: process.env.WECHAT_CLIENT_ID,
    clientSecret: process.env.WECHAT_CLIENT_SECRET,
    redirectUri: process.env.WECHAT_REDIRECT_URI,
  },
  admin: {
    email: process.env.ADMIN_EMAIL || 'admin@example.com',
    password: process.env.ADMIN_PASSWORD || 'admin123456',
  },
  demo: {
    email: process.env.DEMO_EMAIL || 'demo@example.com',
    password: process.env.DEMO_PASSWORD || 'demo123456',
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
  QINIU_ENDPOINT: Joi.string().optional().default('https://s3.cn-east-1.qiniucs.com'),
  QINIU_CDN_DOMAIN: Joi.string().optional(),
  APP_URL: Joi.string().optional(),
  FRONTEND_URL: Joi.string().optional(),
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),
  GITHUB_CLIENT_ID: Joi.string().optional(),
  GITHUB_CLIENT_SECRET: Joi.string().optional(),
  GITHUB_REDIRECT_URI: Joi.string().optional(),
  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),
  GOOGLE_REDIRECT_URI: Joi.string().optional(),
  WECHAT_CLIENT_ID: Joi.string().optional(),
  WECHAT_CLIENT_SECRET: Joi.string().optional(),
  WECHAT_REDIRECT_URI: Joi.string().optional(),
  ADMIN_EMAIL: Joi.string().default('admin@example.com'),
  ADMIN_PASSWORD: Joi.string().default('admin123456'),
  DEMO_EMAIL: Joi.string().default('demo@example.com'),
  DEMO_PASSWORD: Joi.string().default('demo123456'),
});
