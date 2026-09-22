/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'workspaces-must-not-depend-on-upload-or-storage',
      severity: 'error',
      from: { path: '^server/src/workspaces/.+' },
      to: { path: '^server/src/(upload|storage)/.+' },
    },
    {
      name: 'audit-must-not-depend-on-business-modules',
      severity: 'error',
      from: { path: '^server/src/audit/audit\\.service\\.ts$' },
      to: { path: '^server/src/(workspaces|upload|files|storage|quota)/.+' },
    },
    {
      name: 'upload-must-not-import-private-cross-module-files',
      severity: 'error',
      from: { path: '^server/src/upload/.+' },
      to: { path: '^server/src/(workspaces|storage|quota|audit)/.+\\.(internal|impl)\\.ts$' },
    },
    {
      name: 'client-components-must-not-import-server-code',
      severity: 'error',
      from: { path: '^client/src/.+' },
      to: { path: '^server/src/.+' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsConfig: { fileName: 'server/tsconfig.json' },
    enhancedResolveOptions: { extensions: ['.ts', '.tsx', '.js', '.jsx'] },
  },
};
