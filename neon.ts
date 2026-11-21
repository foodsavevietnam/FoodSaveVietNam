import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  // Declare your Neon services here
  preview: {
    realtime: {
      allowedOrigins: [
        "https://foodsavevn.netlify.app",
        "https://foodsavevietnam.netlify.app",
        "https://makeitorganized.netlify.app",
        "https://mio-release-check--makeitorganized.netlify.app",
        "http://127.0.0.1:5500",
        "http://localhost:5500",
      ],
    },
  },
  auth: false,
  // Branch policy: per-branch tuning
  branch: (branch) => {
    if (branch.isDefault) {
      // Default branch: no overrides, uses project defaults
      return {};
    }
    if (!branch.exists) {
      // New non-default branches: auto-expire
      // Run `neon checkout <name>` to create a new branch with these settings
      return { ttl: "7d" };
    }
    // Existing branch: no changes
    return {};
  },
});
