/** PM2 process file. Secrets stay in the server .env, not here. */
module.exports = {
  apps: [
    {
      name: 'wallpaper-api',
      cwd: __dirname,
      script: 'dist/src/main.js',
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '512M',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
