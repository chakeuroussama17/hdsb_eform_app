import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hdsb.eform',
  appName: 'HDSB E-Form',
  webDir: 'dist',
  android: {
    // Allow the WebView to talk to Supabase over https
    allowMixedContent: false,
  },
};

export default config;
