// Copy build output into the test vault's plugin folder.
import { copyFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
const dest = resolve("test-vault/.obsidian/plugins/link-directory");
mkdirSync(dest, { recursive: true });
for (const f of ["main.js", "manifest.json", "styles.css"]) copyFileSync(f, resolve(dest, f));
console.log("deployed to", dest);
