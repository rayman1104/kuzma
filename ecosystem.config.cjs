module.exports = {
  apps: [{
    name: "kuzma",
    script: "src/index.ts",
    interpreter: "bun",
    watch: false,
    autorestart: true,
    max_restarts: 10,
    restart_delay: 5000,
    env: { NODE_ENV: "production" },
  }],
};
