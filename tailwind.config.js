const jiti = require("jiti")(__filename);
const loaded = jiti("./tailwind.config.ts");

module.exports = loaded.default ?? loaded;
