import { ChatOpenAI } from 'langchain/chat_models/openai'
import { OpenAIEmbeddings } from 'langchain/embeddings/openai'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'

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

        // Configure text splitter settings
        this.textSplitter = new RecursiveCharacterTextSplitter({
            chunkSize: 500,
            separators: ['\n\n', '\n', ' ', ''],
            chunkOverlap: 50
        })
    }

    async generateEmbedding(text) {
        return await withRetry(async () => {
            return await this.embeddings.embedQuery(text)
        })
    }

    /**
     * Split text into chunks for processing
     * @param {string} text - The text to split
     * @returns {Promise<Array>} Array of document chunks
     */
    async createDocumentChunks(text) {
        return await this.textSplitter.createDocuments([text])
    }

    /**
     * Get the expected number of chunks for a given text
     * @param {string} text - The text to analyze
     * @returns {Promise<number>} The expected number of chunks
     */
    async getExpectedChunks(text) {
        const documents = await this.createDocumentChunks(text)
        return documents.length
    }

    /**
     * Process a text chunk and generate its embedding
     * @param {Object} chunk - The document chunk to process
     * @returns {Promise<Object>} Processed chunk with embedding
     */
    async processChunk(chunk) {
        const embedding = await this.generateEmbedding(chunk.pageContent)
        return {
            content: chunk.pageContent,
            embedding: embedding
        }
    }
}
