const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const apiDir = path.join(__dirname, "../app/api");
const apiDirHidden = path.join(__dirname, "../app/_api_backup");
const nextTypesDir = path.join(__dirname, "../.next");

try {
  // Clear Next.js cache
  if (fs.existsSync(nextTypesDir)) {
    fs.rmSync(nextTypesDir, { recursive: true, force: true });
    console.log("Cleared .next cache...");
  }

  // Hide the api folder
  fs.renameSync(apiDir, apiDirHidden);
  console.log("Temporarily moved app/api out of the way...");

  // Run the build
  execSync(
    "cross-env CAPACITOR_BUILD=true NEXT_PUBLIC_API_BASE=https://canigolftoday.com next build",
    { stdio: "inherit" }
  );
} finally {
  // Always restore it, even if build fails
  if (fs.existsSync(apiDirHidden)) {
    fs.renameSync(apiDirHidden, apiDir);
    console.log("Restored app/api.");
  }
}