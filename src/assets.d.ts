// esbuild loaders (esbuild.config.mjs): .ttf as bytes, .txt as text.
declare module "*.ttf" { const bytes: Uint8Array; export default bytes; }
declare module "*.txt" { const text: string; export default text; }
