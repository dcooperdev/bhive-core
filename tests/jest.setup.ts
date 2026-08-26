// Ensures SimpleLLM never throws for missing credentials during tests that
// don't pass an explicit API key. Individual tests that need to exercise
// the missing-key error path manage process.env.GOOGLE_API_KEY themselves.
process.env.GOOGLE_API_KEY = process.env.GOOGLE_API_KEY || 'test-key-for-jest';
