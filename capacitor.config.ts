import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.canigolftoday.app",
  appName: "CanIGolfToday",
  webDir: "out",
  server: {
    allowNavigation: ["canigolftoday.com", "*.canigolftoday.com"],
  },
};

export default config;