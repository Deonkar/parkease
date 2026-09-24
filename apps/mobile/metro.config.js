const path = require('path');

const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');
const packagesDir = path.resolve(monorepoRoot, 'packages');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [monorepoRoot];

// Watching the whole monorepo means Metro crawls everything under it. `.claude/worktrees` holds
// full checkouts, each with its own node_modules and its own copies of the @parkease/* packages,
// so the first start sat on "Starting Metro Bundler" for minutes. None of these are app source.
const escapeForRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
config.resolver.blockList = [
  ...[].concat(config.resolver.blockList ?? []),
  ...['.claude', '.superpowers', 'graphify-out'].map(
    (dir) => new RegExp(`^${escapeForRegExp(path.resolve(monorepoRoot, dir))}[\\\\/]`),
  ),
];

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
];

const nativeOnlyModules = ['react-native-pager-view', '@maplibre/maplibre-react-native'];
const webStubs = {
  'react-native-pager-view': path.resolve(projectRoot, 'src/polyfills/pager-view-web-stub'),
  '@maplibre/maplibre-react-native': path.resolve(projectRoot, 'src/polyfills/maplibre-web-stub'),
};

// maplibre-gl is the web-only GL JS library. ParkMap requires it behind a
// Platform.OS check, but Metro bundles every require() regardless, so stub it
// out on native to keep it from shipping in the native bundle.
const webOnlyModules = ['maplibre-gl'];
const nativeStubs = {
  'maplibre-gl': path.resolve(projectRoot, 'src/polyfills/maplibre-gl-native-stub'),
};

// Workspace packages use NodeNext .js extensions in imports that point to .ts source.
// Only rewrite for files inside packages/ — not for node_modules or react-native internals.
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && nativeOnlyModules.includes(moduleName)) {
    return {
      filePath: webStubs[moduleName] + '.tsx',
      type: 'sourceFile',
    };
  }

  if (platform !== 'web' && webOnlyModules.includes(moduleName)) {
    return {
      filePath: nativeStubs[moduleName] + '.ts',
      type: 'sourceFile',
    };
  }

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
