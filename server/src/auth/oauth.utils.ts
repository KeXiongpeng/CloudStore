import { createHash, timingSafeEqual } from 'crypto';

export type OAuthProviderName = 'github' | 'google' | 'wechat';

export interface OAuthClientCredentials {
  clientId?: string;
  clientSecret?: string;
}

export function getEnabledOAuthProviders(
  credentials: Partial<Record<OAuthProviderName, OAuthClientCredentials>>,
): OAuthProviderName[] {
  const providers: OAuthProviderName[] = [];

  for (const provider of ['github', 'google', 'wechat'] as const) {
    const client = credentials[provider];
    if (client?.clientId && client?.clientSecret) {
      providers.push(provider);
    }
  }

  return providers;
}

export function buildOAuthRedirectUri(
  appUrl: string,
  provider: OAuthProviderName,
  configuredRedirectUri?: string,
): string {
  if (configuredRedirectUri) {
    return configuredRedirectUri;
  }

  const normalizedAppUrl = appUrl.replace(/\/+$/, '');
  return `${normalizedAppUrl}/api/auth/${provider}/callback`;
}

export function isValidOAuthState(expectedState: unknown, receivedState: unknown): boolean {
  if (typeof expectedState !== 'string' || typeof receivedState !== 'string') {
    return false;
  }

  if (expectedState.length === 0 || receivedState.length === 0) {
    return false;
  }

  const expectedHash = createHash('sha256').update(expectedState).digest();
  const receivedHash = createHash('sha256').update(receivedState).digest();
  return timingSafeEqual(expectedHash, receivedHash);
}

export function buildWechatIdentityEmail(openId: string, unionId?: string): string {
  const identity = (unionId || openId).replace(/[^a-zA-Z0-9._-]/g, '').toLowerCase();
  return `wechat_${identity}@wechat.local`;
}
