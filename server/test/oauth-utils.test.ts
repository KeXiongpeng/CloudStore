import {
  buildOAuthRedirectUri,
  buildWechatIdentityEmail,
  getEnabledOAuthProviders,
  isValidOAuthState,
} from '../src/auth/oauth.utils';

const credentials = {
  github: { clientId: 'github-id', clientSecret: 'github-secret' },
  google: { clientId: '', clientSecret: 'google-secret' },
  wechat: { clientId: 'wechat-id', clientSecret: 'wechat-secret' },
};

describe('oauth utils', () => {
  it('returns only enabled OAuth providers', () => {
    expect(getEnabledOAuthProviders(credentials)).toEqual(['github', 'wechat']);
    expect(getEnabledOAuthProviders({})).toEqual([]);
  });

  it('builds provider redirect URLs with optional overrides', () => {
    expect(buildOAuthRedirectUri('https://kxpwty.cn', 'github')).toBe(
      'https://kxpwty.cn/api/auth/github/callback',
    );
    expect(
      buildOAuthRedirectUri('https://kxpwty.cn', 'google', 'https://custom.example/google'),
    ).toBe('https://custom.example/google');
  });

  it('validates OAuth state', () => {
    expect(isValidOAuthState('same-value', 'same-value')).toBe(true);
    expect(isValidOAuthState('same-value', 'other-value')).toBe(false);
    expect(isValidOAuthState('', 'same-value')).toBe(false);
    expect(isValidOAuthState('same-value', '')).toBe(false);
    expect(isValidOAuthState(undefined as any, 'same-value')).toBe(false);
  });

  it('builds deterministic WeChat identity emails', () => {
    expect(buildWechatIdentityEmail('openid-value')).toBe('wechat_openid-value@wechat.local');
    expect(buildWechatIdentityEmail('openid-value', 'unionid-value')).toBe(
      'wechat_unionid-value@wechat.local',
    );
  });
});
