export class RateLimiter {
    constructor(maxRequests, timeWindowSeconds) {
        this.maxRequests = maxRequests
        this.timeWindowMs = timeWindowSeconds * 1000
        this.tokens = maxRequests
        this.lastRefill = Date.now()
        this.queue = []
    }

    async waitForToken() {
        this._refillTokens()

        if (this.tokens > 0) {
            this.tokens--
            return Promise.resolve()
        }

        // If no tokens available, queue the request
        return new Promise((resolve) => {
            this.queue.push(() => {
                this.tokens--
                resolve()
            })
            
            // Set timeout to prevent indefinite waiting
            setTimeout(() => {
                const index = this.queue.indexOf(resolve)
                if (index > -1) {
                    this.queue.splice(index, 1)
                    resolve() // Resolve anyway after timeout
                }
            }, this.timeWindowMs)
        })
    }

    _refillTokens() {
        const now = Date.now()
        const timePassed = now - this.lastRefill
        const tokensToAdd = Math.floor(timePassed / this.timeWindowMs) * this.maxRequests

        if (tokensToAdd > 0) {
            this.tokens = Math.min(this.maxRequests, this.tokens + tokensToAdd)
            this.lastRefill = now

            // Process queued requests if we have tokens
            while (this.queue.length > 0 && this.tokens > 0) {
                const nextRequest = this.queue.shift()
                nextRequest()
            }
        }
    }
}

export async function withRetry(operation, maxRetries = 3, initialDelay = 20000) {
    // ... existing withRetry function ...
}

// Export a singleton instance
export const rateLimiter = new RateLimiter(3, 60) // Adjusted to 3 requests per minute for embeddings and 60 seconds for chat