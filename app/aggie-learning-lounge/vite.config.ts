import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import babel from '@rolldown/plugin-babel'
import { defineConfig, loadEnv } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) =>
{
    const env = loadEnv(mode, process.cwd(), 'BACKEND_')
    const proxy = {
        '^/api/': {
            target: env.BACKEND_URL || 'http://127.0.0.1:3000',
            changeOrigin: true,
            rewrite: (path: string) => path.replace(/^\/api/, ''),
            // Rewrite both refresh and logout cookies to the browser-visible auth path.
            cookiePathRewrite: { '/auth': '/api/auth' },
        },
    }

    return {
        plugins: [tailwindcss(), react(), babel({ presets: [reactCompilerPreset()] })],
        server: { proxy },
        preview: { proxy },
    }
})
