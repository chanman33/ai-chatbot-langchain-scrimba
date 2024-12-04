class RateLimiter {
    constructor(tokensPerMinute = 3) {
        this.tokensPerMinute = tokensPerMinute
        this.tokens = tokensPerMinute
        this.lastRefill = Date.now()
    }

    async waitForToken() {
        this.refillTokens()
        
        if (this.tokens < 1) {
            // Calculate wait time until next token is available
            const waitTime = (60000 / this.tokensPerMinute)
            await new Promise(resolve => setTimeout(resolve, waitTime))
            this.refillTokens()
        }
        
        this.tokens -= 1
        return true
    }

    refillTokens() {
        const now = Date.now()
        const timePassed = now - this.lastRefill
        const refillAmount = (timePassed / 60000) * this.tokensPerMinute

        this.tokens = Math.min(
            this.tokensPerMinute,
            this.tokens + refillAmount
        )
        this.lastRefill = now
    }
}

// Export a singleton instance
export const rateLimiter = new RateLimiter(3) // Adjusted to 3 requests per minute