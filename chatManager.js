import { ChatMessageHistory, BufferMemory } from 'langchain/memory'
import { PromptTemplate } from 'langchain/prompts'
import { StringOutputParser } from 'langchain/schema/output_parser'

/**
 * ChatManager Class
 * Handles all chat-related functionality including message history, 
 * prompt generation, and interaction with AI models
 */
export class ChatManager {
    /**
     * Initialize the ChatManager with necessary services
     * @param {OpenAIService} openAIService - Service for interacting with OpenAI
     * @param {SupabaseVectorStore} vectorStore - Store for document embeddings
     * @param {RateLimiter} rateLimiter - Rate limiter for API calls
     */
    constructor(openAIService, vectorStore, rateLimiter) {
        this.openAIService = openAIService
        this.vectorStore = vectorStore
        this.rateLimiter = rateLimiter

        // Initialize chat history storage
        this.chatHistory = new ChatMessageHistory()
        
        // Set up memory buffer for maintaining conversation context
        this.memory = new BufferMemory({
            chatHistory: this.chatHistory,
            memoryKey: "chat_history",
            returnMessages: true,
        })

        // Initialize prompt template for converting questions to standalone format
        this.standaloneQuestionTemplate = new PromptTemplate({
            template: `Given the following conversation history and a new question, convert the new question to a standalone question that captures the context of the conversation.

Chat History: {chat_history}
New Question: {question}

Standalone question:`,
            inputVariables: ["chat_history", "question"]
        })

        // Initialize prompt template for generating answers
        this.answerTemplate = new PromptTemplate({
            template: `You are a helpful and enthusiastic support bot who can answer questions about Scrimba based on the provided context.

Instructions:
- Use the context and chat history to answer the question
- Pay special attention to personal details shared in the chat history (like names, preferences, etc.)
- Maintain context from previous exchanges
- Respond in a friendly, conversational tone using the user's name when known
- If the answer is in the context, provide specific details
- If you're not certain, say "I'm not entirely sure about that"
- For questions you cannot answer, respond: "I'm sorry, I don't know the answer to that. Please email help@scrimba.com for assistance"
- Keep responses concise but informative
- Include relevant examples when available in the context

Previous conversation:
{chat_history}

Context: {context}
Question: {question}
Answer:`,
            inputVariables: ["chat_history", "context", "question"]
        })
    }

    /**
     * Process user input and generate AI response
     * @param {string} question - The user's question
     * @returns {Promise<string>} The AI's response
     */
    async processUserInput(question) {
        try {
            // Wait for rate limiter before proceeding
            await this.rateLimiter.waitForToken()
            
            return await this.withRetry(async () => {
                // Set up retriever for finding relevant documents
                const retriever = this.vectorStore.asRetriever()
                const llm = this.openAIService.chatModel

                // Get formatted chat history
                const chatHistoryText = await this.formatChatHistory()

                // Create standalone question chain
                const standaloneChain = this.standaloneQuestionTemplate
                    .pipe(llm)
                    .pipe(new StringOutputParser())

                // Generate standalone question with context
                const standaloneQuestion = await this.withRetry(async () => {
                    await this.delay(1000) // Rate limiting delay
                    return await standaloneChain.invoke({
                        question: question,
                        chat_history: chatHistoryText
                    })
                })

                await this.delay(1000) // Rate limiting delay

                // Retrieve relevant documents
                const documents = await this.withRetry(async () => {
                    return await retriever.invoke(standaloneQuestion)
                })

                // Combine and trim document content
                const combinedDocs = this.combineDocuments(documents)
                const trimmedContext = this.trimContext(combinedDocs)

                // Create answer chain
                const answerChain = this.answerTemplate
                    .pipe(llm)
                    .pipe(new StringOutputParser())

                await this.delay(1000) // Rate limiting delay

                // Generate response
                const response = await this.withRetry(async () => {
                    return await answerChain.invoke({
                        context: trimmedContext,
                        question: standaloneQuestion,
                        chat_history: chatHistoryText
                    })
                })

                // Update chat history with new interaction
                await this.updateChatHistory(question, response)

                // Format and return response
                return this.formatResponse(this.validateResponse(response))
            })
        } catch (error) {
            console.error('Error in processUserInput:', error)
            if (error.message?.includes('Rate limit')) {
                return "I'm currently experiencing high demand. Please wait 20 seconds before trying again."
            }
            return "I apologize, but I'm having trouble processing your question. Please try again shortly."
        }
    }

    /**
     * Add a delay between operations
     * @param {number} ms - Milliseconds to delay
     */
    async delay(ms) {
        await new Promise(resolve => setTimeout(resolve, ms))
    }

    /**
     * Retry an operation multiple times with exponential backoff
     * @param {Function} operation - The operation to retry
     * @param {number} maxRetries - Maximum number of retry attempts
     * @param {number} initialDelay - Initial delay between retries in milliseconds
     */
    async withRetry(operation, maxRetries = 3, initialDelay = 20000) {
        let lastError
        for (let i = 0; i < maxRetries; i++) {
            try {
                return await operation()
            } catch (error) {
                lastError = error
                
                if (error.response?.status === 429 || error.message?.includes('Rate limit')) {
                    const waitMatch = error.message?.match(/try again in (\d+)s/)
                    const waitTime = waitMatch ? parseInt(waitMatch[1]) * 1000 : initialDelay * Math.pow(2, i)
                    
                    console.log(`Rate limit hit, waiting ${waitTime/1000} seconds... (Attempt ${i + 1}/${maxRetries})`)
                    await this.delay(waitTime)
                    continue
                }
                throw error
            }
        }
        throw lastError
    }

    /**
     * Format chat history into readable text
     * @returns {Promise<string>} Formatted chat history
     */
    async formatChatHistory() {
        const messages = await this.chatHistory.getMessages()
        if (!messages || messages.length === 0) return "No previous conversation."
        
        return messages.map(msg => {
            const role = msg.type === 'human' ? 'User' : 'Assistant'
            return `${role}: ${msg.content}`
        }).join('\n')
    }

    /**
     * Combine multiple documents into a single text
     * @param {Array} docs - Array of documents
     * @returns {string} Combined document text
     */
    combineDocuments(docs) {
        return docs.map((doc, index) => `[Document ${index + 1}]:\n${doc.pageContent}`).join('\n\n')
    }

    /**
     * Trim context to maximum length
     * @param {string} context - Context text to trim
     * @param {number} maxLength - Maximum length allowed
     * @returns {string} Trimmed context
     */
    trimContext(context, maxLength = 4000) {
        if (context.length > maxLength) {
            return context.slice(0, maxLength) + "..."
        }
        return context
    }

    /**
     * Validate AI response
     * @param {string} response - Response to validate
     * @returns {string} Validated response or error message
     */
    validateResponse(response) {
        if (response.length < 10) {
            return "I apologize, but I couldn't generate a proper response. Please try asking your question differently."
        }
        return response
    }

    /**
     * Format the response with proper markdown
     * @param {string} response - Response to format
     * @returns {string} Formatted response
     */
    formatResponse(response) {
        return response
            .replace(/`([^`]+)`/g, '```$1```')
            .replace(/\b(Note|Important|Warning):/g, '**$1:**')
    }

    /**
     * Update chat history with new interaction
     * @param {string} question - User's question
     * @param {string} response - AI's response
     */
    async updateChatHistory(question, response) {
        await this.chatHistory.addMessage({
            type: 'human',
            content: question
        })
        
        await this.chatHistory.addMessage({
            type: 'ai',
            content: response
        })
    }

    /**
     * Clear chat history and reset memory
     */
    async clearHistory() {
        this.chatHistory = new ChatMessageHistory()
        this.memory = new BufferMemory({
            chatHistory: this.chatHistory,
            memoryKey: "chat_history",
            returnMessages: true,
        })
    }
}
