import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register({
	settings: {
		fetch: {
			disableSameOriginPolicy: true,
		},
	},
})

// Set default env vars for tests that import packages requiring them
process.env.ENVIRONMENT ??= 'local'
process.env.S3_SECRET ??= 'test-secret'
process.env.AUTH_TOKEN ??= 'test-token'
process.env.BETTER_AUTH_SECRET ??= 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
process.env.BETTER_AUTH_URL ??= 'http://localhost:5173'
process.env.BACKEND_TOKEN ??= 'test-backend-token'
process.env.CONTEMBER_API_TOKEN ??= '0000000000000000000000000000000000000000'
process.env.CLOUDFLARE_API_TOKEN ??= 'test-cloudflare-token'
process.env.E2B_API_KEY ??= 'test-e2b-key'
process.env.GITHUB_CLIENT_SECRET ??= 'test-github-secret'
process.env.GITHUB_PRIVATE_KEY ??= 'test-github-key'
process.env.GITHUB_WEBHOOK_SECRET ??= 'test-github-webhook-secret'
process.env.MESSENGER_APP_SECRET ??= 'test-messenger-secret'
process.env.MESSENGER_PAGE_ACCESS_TOKEN ??= 'test-messenger-token'
process.env.OPENROUTER_API_KEY ??= 'test-openrouter-key'
process.env.PAGE_SPEED_INSIGHTS_KEY ??= 'test-pagespeed-key'
process.env.STRIPE_SECRET_KEY ??= 'test-stripe-key'
process.env.STRIPE_WEBHOOK_SECRET ??= 'test-stripe-webhook'
process.env.WHATSAPP_ACCESS_TOKEN ??= 'test-whatsapp-token'
process.env.WHATSAPP_APP_SECRET ??= 'test-whatsapp-secret'
process.env.POSTMARK_API_TOKEN ??= 'test-postmark-token'
process.env.SLACK_BOT_TOKEN ??= 'test-slack-token'
