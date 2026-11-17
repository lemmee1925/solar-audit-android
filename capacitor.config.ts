import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cleanmax.solaraudit',
  appName: 'Solar Audit Mobile',
  webDir: 'dist',
  backgroundColor: '#f5f4ef',
  server: {
    androidScheme: 'http',
  },
};

export default config;