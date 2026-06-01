// Server Configuration
const PORT = process.env.PORT || 3001;

module.exports = {
  // Server Port
  PORT,

  // Allowed CORS Origins (auto-include current PORT)
  CORS_ORIGINS: [
    `http://localhost:${PORT}`,
    `http://127.0.0.1:${PORT}`,
    'http://localhost:3001', 'http://127.0.0.1:3001',
    'http://localhost:5173', 'http://127.0.0.1:5173',
  ],

  // Rate Limiting
  RATE_LIMIT: {
    WINDOW_MS: 15 * 60 * 1000, // 15 minutes
    MAX_REQUESTS: 2000,
    MESSAGE: 'Too many requests from this IP, please try again later.'
  },

  // File Watching
  WATCH_CONFIG: {
    PERSISTENT: true,
    IGNORE_INITIAL: true,
    USE_POLLING: true,
    INTERVAL: 1000,
    BINARY_INTERVAL: 1000,
    DEPTH: 10,
    AWAIT_WRITE_FINISH: {
      stabilityThreshold: 500,
      pollInterval: 100
    }
  },

  // Security
  HELMET_CONFIG: {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", `ws://localhost:${PORT}`, `ws://127.0.0.1:${PORT}`, "ws://localhost:3001", "ws://localhost:5173", "http://localhost:3001", "http://localhost:5173"],
        imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net", "https://api.star-history.com", "https://avatars.githubusercontent.com"],
        fontSrc: ["'self'", "data:"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "same-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    noSniff: true,
    frameguard: { action: 'deny' },
    xssFilter: true
  }
};
