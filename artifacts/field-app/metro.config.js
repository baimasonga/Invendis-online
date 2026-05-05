const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const config = getDefaultConfig(__dirname);

// Monorepo: watch workspace root so shared libs resolve
const workspaceRoot = path.resolve(__dirname, "../..");
const projectRoot = __dirname;

// Only watch the lib directory and workspace node_modules.
// Watching the entire workspace root triggers ENOENT crashes when
// Replit deletes temp skill directories mid-session.
config.watchFolders = [
  path.resolve(workspaceRoot, "lib"),
  path.resolve(workspaceRoot, "node_modules"),
];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// Block AWS SDK packages — server-only, create temp dirs that trigger Metro ENOENT crashes
const AWS_PKGS = ["@aws-sdk", "@aws-crypto", "@smithy"];
const blockPatterns = AWS_PKGS.map(
  (pkg) => new RegExp(`node_modules[\\/\\\\]${pkg.replace("/", "[\\/\\\\]")}`)
);

const existing = config.resolver.blockList;
config.resolver.blockList = Array.isArray(existing)
  ? [...existing, ...blockPatterns]
  : existing instanceof RegExp
  ? [existing, ...blockPatterns]
  : blockPatterns;

module.exports = config;
