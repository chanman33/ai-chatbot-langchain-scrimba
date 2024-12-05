import { ChatOpenAI } from 'langchain/chat_models/openai'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'

export class OpenAIService {
    constructor(config) {
        this.embeddings = new OpenAIEmbeddings({
            openAIApiKey: config.openAIApiKey
        })
        
        this.chatModel = new ChatOpenAI({
            openAIApiKey: config.openAIApiKey,
            temperature: 0.7,
            maxTokens: 500,
            modelName: 'gpt-3.5-turbo',
            maxRetries: 3,
            timeout: 30000,
            streaming: false,
            retryDelay: 20,
        })
    }

    async generateEmbedding(text) {
        return await withRetry(async () => {
            // ... existing generateEmbedding logic ...
        })
    }
}
