import { cpSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { buildDemo } from "./bundle-demos-core";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

buildDemo("dress-room")
    .then(() => {
        // buildDemo uses lab/public/bundle/demos/dress-room/ as its scratch dir and
        // removes it, which also wipes the copied runtime assets that live there.
        // Re-copy them so a standalone rebuild leaves a serveable demo.
        cpSync(resolve(ROOT, "lab/public/dress-room"), resolve(ROOT, "lab/public/bundle/demos/dress-room"), { recursive: true });
        // eslint-disable-next-line no-console
        console.log("✓ dress-room rebuilt + assets re-copied");
    })
    .catch((err) => {
        console.error(err);
        process.exit(1);
    });
