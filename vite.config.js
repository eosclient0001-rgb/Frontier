export default {
  server: {
    host: '0.0.0.0',
    port: 5173,
    hmr: {
      clientPort: 443
    },
    cors: true,
    headers: {
      'X-Frame-Options': 'ALLOWALL'
    },
    // allow all hosts for E2B preview
    allowedHosts: true,
  },
  preview: {
    host: '0.0.0.0',
    port: 5173,
    cors: true,
  }
}
