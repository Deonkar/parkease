const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const packagesDir = path.resolve(monorepoRoot, 'packages');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

// Workspace packages use NodeNext .js extensions in imports that point to .ts source.
// Only rewrite for files inside packages/ — not for node_modules or react-native internals.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (
    moduleName.endsWith('.js') &&
    context.originModulePath &&
    context.originModulePath.startsWith(packagesDir) &&
    !context.originModulePath.includes('node_modules')
  ) {
    const tsName = moduleName.replace(/\.js$/, '.ts');
    const tsxName = moduleName.replace(/\.js$/, '.tsx');
    for (const alt of [tsName, tsxName]) {
      try {
        return context.resolveRequest(context, alt, platform);
      } catch {
        /* extension not found, try next */
      }
    }
  }
  if (originalResolveRequest) {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
