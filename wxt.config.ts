import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  manifest: {
    name: 'DealGauge for Willhaben',
    description: 'Evaluate used car deals on willhaben.at based on pages you view.',
    permissions: ['storage', 'tabs'],
    host_permissions: ['https://www.willhaben.at/*'],
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      96: 'icon/96.png',
      128: 'icon/128.png',
    },
    action: {
      default_icon: {
        16: 'icon/16.png',
        32: 'icon/32.png',
        48: 'icon/48.png',
        96: 'icon/96.png',
        128: 'icon/128.png',
      },
    },
    web_accessible_resources: [
      {
        resources: ['icon/16.png', 'icon/32.png', 'icon/48.png', 'icon/96.png', 'icon/128.png'],
        matches: ['https://www.willhaben.at/*'],
      },
    ],
  },
});
