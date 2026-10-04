/**
 * Side-effect CSS imports (MapLibre's stylesheet) have no type declarations.
 * Next compiles these at build time; TypeScript just needs to be told they
 * resolve to something.
 */
declare module "*.css";
