/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      comment: 'Circular dependencies are forbidden by AGENTS.md Section 6A.2.',
      from: { path: '^src/' },
      to: { circular: true },
    },
    {
      name: 'server-no-ui-or-app',
      severity: 'error',
      comment: 'Server modules/shared code must not depend on delivery routes, UI components, or React.',
      from: { path: '^src/server/' },
      to: { path: '^(src/(app|features|components)/|node_modules/react(/|$))' },
    },
    {
      name: 'policy-must-be-pure',
      severity: 'error',
      comment: 'Domain policy.ts files must stay pure without DB, repository, or HTTP imports.',
      from: { path: '^src/server/modules/[^/]+/policy\\.ts$' },
      to: {
        path: '^(node_modules/(drizzle-orm|pg|next/server)|src/server/shared/(db|transaction|http)\\.ts$|src/server/modules/[^/]+/repository\\.ts$|db/)',
      },
    },
    {
      name: 'service-no-http',
      severity: 'error',
      comment: 'Service layer must not depend on HTTP/Next delivery wrappers.',
      from: { path: '^src/server/modules/[^/]+/service\\.ts$' },
      to: { path: '^(node_modules/next/server|src/server/shared/http\\.ts$)' },
    },
    {
      name: 'no-sql-outside-repository',
      severity: 'error',
      comment: 'Drizzle/pg and db/ schema access are restricted to db/, shared db/transaction adapters, and module repositories.',
      from: {
        path: '^src/',
        pathNot: [
          '^src/server/shared/(db|transaction)\\.ts$',
          '^src/server/modules/[^/]+/repository\\.ts$',
        ],
      },
      to: { path: '^(node_modules/(drizzle-orm|pg)(/|$)|db/)' },
    },
    {
      name: 'no-cross-module-internals',
      severity: 'error',
      comment: 'Modules may only import another module via its public index.ts entrypoint.',
      from: { path: '^src/server/modules/([^/]+)/' },
      to: {
        path: '^src/server/modules/[^/]+/(?!index\\.ts$)',
        pathNot: '^src/server/modules/$1/',
      },
    },
    {
      name: 'frontend-no-server',
      severity: 'error',
      comment: 'Frontend features and components must not import server internals or DB schema directly.',
      from: { path: '^src/(features|components)/' },
      to: { path: '^(src/server/|db/)' },
    },
  ],
  options: {
    doNotFollow: {
      path: 'node_modules',
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: 'tsconfig.json',
    },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['types', 'import', 'require', 'node', 'default'],
    },
  },
};
