const base = require("./vite.config.cjs");

module.exports = {
  ...base,
  publicDir: ".cloudflare-public",
  build: {
    ...base.build,
    outDir: "dist-cloudflare",
    emptyOutDir: true,
  },
};
