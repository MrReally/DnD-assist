import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		setupFiles: ['tests/setup-srd.ts'],
		environment: 'node',
		include: ['tests/**/*.test.ts'],
		reporters: ['default'],
	},
});
