import assert from 'node:assert/strict';
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

assert.deepEqual(getEnabledOAuthProviders(credentials), ['github', 'wechat']);
assert.deepEqual(getEnabledOAuthProviders({}), []);

assert.equal(
  buildOAuthRedirectUri('https://kxpwty.cn', 'github'),
  'https://kxpwty.cn/api/auth/github/callback',
);
assert.equal(
  buildOAuthRedirectUri('https://kxpwty.cn', 'google', 'https://custom.example/google'),
  'https://custom.example/google',
);

assert.equal(isValidOAuthState('same-value', 'same-value'), true);
assert.equal(isValidOAuthState('same-value', 'other-value'), false);
assert.equal(isValidOAuthState('', 'same-value'), false);
assert.equal(isValidOAuthState('same-value', ''), false);
assert.equal(isValidOAuthState(undefined as any, 'same-value'), false);

assert.equal(
  buildWechatIdentityEmail('openid-value'),
  'wechat_openid-value@wechat.local',
);
assert.equal(
  buildWechatIdentityEmail('openid-value', 'unionid-value'),
  'wechat_unionid-value@wechat.local',
);

console.log('OAuth utility tests passed');
