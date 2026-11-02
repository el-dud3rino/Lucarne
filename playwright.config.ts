export default {
  testDir: './tests/e2e',
  timeout: 30000,
  use: {
    channel: 'msedge',
    headless: true,
  },
  projects: [
    {
      name: 'kiosk',
      use: {
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: 'mobile',
      use: {
        viewport: { width: 390, height: 844 },
      },
    },
  ],
};
