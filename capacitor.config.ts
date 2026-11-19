import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cleanmax.solaraudit',
  appName: 'CMES AssetCare',
  webDir: 'dist',
  backgroundColor: '#f5f4ef',
  server: {
    androidScheme: 'http',
  },
};

export default config;