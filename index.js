// Import necessary dependencies and services
import { RateLimiter } from './rateLimit.js'
import { SupabaseService } from './supabaseService.js'
import { OpenAIService } from './openAIService.js'
import { ChatManager } from './chatManager.js'
import { SupabaseVectorStore } from 'langchain/vectorstores/supabase'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'

/**
 * Main Application Class
 * Handles initialization, document processing, and chat functionality
 */
class App {
    constructor() {
        // Load environment variables for API keys and URLs
        this.openAIApiKey = import.meta.env.VITE_OPENAI_API_KEY
        this.supabaseUrl = import.meta.env.VITE_SUPABASE_URL
        this.supabaseKey = import.meta.env.VITE_SUPABASE_API_KEY

        // Create instances of our service classes
        this.supabaseService = new SupabaseService({
            supabaseUrl: this.supabaseUrl,
            supabaseKey: this.supabaseKey
        })
        this.openAIService = new OpenAIService({
            openAIApiKey: this.openAIApiKey
        })
        
        // Set up rate limiters to prevent API overuse
        // Arguments: (requests per minute, time window in seconds)
        this.embeddingRateLimiter = new RateLimiter(3, 60)
        this.chatRateLimiter = new RateLimiter(3, 60)

        // Initialize vector store for document storage and retrieval
        this.vectorStore = new SupabaseVectorStore(this.openAIService.embeddings, {
            client: this.supabaseService.client,
            tableName: 'documents',
            queryName: 'match_documents'
        })

        // Create chat manager instance to handle conversations
        this.chatManager = new ChatManager(
            this.openAIService,
            this.vectorStore,
            this.chatRateLimiter
        )

        // Set up event listeners and initialize the application
        this.setupEventListeners()
        this.initialize()

        // Add this after loading environment variables in the constructor
        const config = {
            openAIApiKey: this.openAIApiKey,
            supabaseUrl: this.supabaseUrl,
            supabaseKey: this.supabaseKey
        }
    }

    /**
     * Set up event listeners for user interactions
     */
    setupEventListeners() {
        // Listen for form submissions (user sending a message)
        document.addEventListener('submit', (e) => {
            e.preventDefault()
            this.progressConversation()
        })
    }

    /**
     * Initialize the application
     * Checks for existing documents and handles initial setup
     */
    async initialize() {
        try {
            const chatbotConversation = document.getElementById('chatbot-conversation-container')

            // Check if we have any previously processed documents
            const { hasDocuments, lastProcessedIndex } = await this.supabaseService.checkExistingDocuments()

            if (hasDocuments && lastProcessedIndex >= 0) {
                // Handle case where documents were previously processed
                await this.handleExistingDocuments(chatbotConversation, lastProcessedIndex)
            } else {
                // Handle first-time document processing
                await this.handleInitialProcessing(chatbotConversation)
            }
        } catch (error) {
            console.error('Initialization error:', error)
            this.appendMessage(
                document.getElementById('chatbot-conversation-container'),
                "Sorry, I encountered an error during initialization. Please refresh the page to try again.",
                'error'
            )
        }
    }

    /**
     * Handle case where documents were previously processed
     * @param {HTMLElement} chatbotConversation - The chat container element
     * @param {number} lastProcessedIndex - Index of the last processed document
     */
    async handleExistingDocuments(chatbotConversation, lastProcessedIndex) {
        const { expectedChunks, text } = await this.getTextFileInfo()

        if (lastProcessedIndex + 1 === expectedChunks) {
            // All documents are processed, ready for chat
            console.log('All documents processed. Ready for questions!')
            this.appendMessage(
                chatbotConversation,
                "Hi! I'm ready to answer your questions about Scrimba. What would you like to know?",
                'ai'
            )
        } else {
            // Some documents still need processing
            await this.resumeProcessing(chatbotConversation, lastProcessedIndex, expectedChunks)
        }
    }

    /**
     * Handle initial document processing
     * @param {HTMLElement} chatbotConversation - The chat container element
     */
    async handleInitialProcessing(chatbotConversation) {
        console.log('Starting initial document processing...')
        this.appendMessage(
            chatbotConversation,
            "Please wait while I process the documentation...",
            'ai'
        )

        // Create a message to show processing status
        const processingMessage = this.appendMessage(
            chatbotConversation,
            "Processing: 0/0 chunks",
            'status'
        )

        // Update the processing status message as chunks are processed
        window.addEventListener('processingUpdate', (e) => {
            processingMessage.textContent = `Processing: ${e.detail.current}/${e.detail.total} chunks`
        })

        await this.processTextFile()
        processingMessage.textContent = "Processing complete! You can now ask questions."
    }

    /**
     * Get information about the text file to be processed
     * @returns {Object} Object containing expected chunks and text content
     */
    async getTextFileInfo() {
        const response = await fetch('./scrimba-info.txt')
        const text = await response.text()
        const expectedChunks = await this.openAIService.getExpectedChunks(text)
        return { expectedChunks, text }
    }

    /**
     * Resume processing from a previous point
     * @param {HTMLElement} chatbotConversation - The chat container element
     * @param {number} lastProcessedIndex - Index of last processed chunk
     * @param {number} expectedChunks - Total number of expected chunks
     */
    async resumeProcessing(chatbotConversation, lastProcessedIndex, expectedChunks) {
        console.log('Partial processing detected. Resuming...')
        this.appendMessage(
            chatbotConversation,
            "Resuming previous processing...",
            'ai'
        )

        const processingMessage = this.appendMessage(
            chatbotConversation,
            `Resuming from chunk ${lastProcessedIndex + 1}/${expectedChunks}`,
            'status'
        )

        // Update processing status message
        window.addEventListener('processingUpdate', (e) => {
            processingMessage.textContent = `Processing: ${e.detail.current}/${e.detail.total} chunks${e.detail.resuming ? ' (Resumed)' : ''}`
        })

        await this.processTextFile()
        processingMessage.textContent = "Processing complete! You can now ask questions."
    }

    /**
     * Process the text file into chunks and store them
     */
    async processTextFile() {
        let processedCount = 0

        try {
            const { lastProcessedIndex } = await this.supabaseService.checkExistingDocuments()
            const response = await fetch('./scrimba-info.txt')
            const text = await response.text()

            // Split text into chunks using OpenAIService
            const documentChunks = await this.openAIService.createDocumentChunks(text)
            const totalChunks = documentChunks.length

            if (lastProcessedIndex >= 0) {
                processedCount = lastProcessedIndex + 1
            }

            this.dispatchProcessingUpdate(processedCount, totalChunks, lastProcessedIndex >= 0)

            for (let i = lastProcessedIndex + 1; i < documentChunks.length; i++) {
                const chunk = documentChunks[i]
                await this.processChunk(chunk, i)
                processedCount++
                this.dispatchProcessingUpdate(processedCount, totalChunks, lastProcessedIndex >= 0)
            }

            return this.verifyProcessing(totalChunks)
        } catch (err) {
            console.error('An error occurred during text processing:', err)
            throw err
        }
    }

    /**
     * Process an individual chunk of text
     * @param {Object} chunk - The text chunk to process
     * @param {number} index - The index of the chunk
     */
    async processChunk(chunk, index) {
        try {
            if (index > 0) {
                await new Promise(resolve => setTimeout(resolve, 2000))
            }

            const existingChunk = await this.supabaseService.checkExistingChunk(index)

            if (existingChunk) {
                console.log(`Chunk ${index} already exists, skipping...`)
                return
            }

            const processedChunk = await this.openAIService.processChunk(chunk)
            await this.supabaseService.insertChunk(processedChunk, index)

        } catch (error) {
            console.error(`Error processing chunk ${index}:`, error)
        }
    }

    /**
     * Verify that all chunks were processed correctly
     * @param {number} totalChunks - Expected number of chunks
     * @returns {boolean} Whether processing is complete
     */
    async verifyProcessing(totalChunks) {
        const finalCount = await this.supabaseService.getDocumentCount()
        const isComplete = finalCount === totalChunks
        console.log(`Processing ${isComplete ? 'complete' : 'incomplete'}. Processed ${finalCount}/${totalChunks} chunks`)
        return isComplete
    }

    /**
     * Dispatch an event to update processing status
     * @param {number} current - Current chunk number
     * @param {number} total - Total number of chunks
     * @param {boolean} resuming - Whether processing is being resumed
     */
    dispatchProcessingUpdate(current, total, resuming = false) {
        window.dispatchEvent(new CustomEvent('processingUpdate', {
            detail: { current, total, resuming }
        }))
    }

    /**
     * Handle a conversation turn (user input and AI response)
     */
    async progressConversation() {
        const userInput = document.getElementById('user-input')
        const chatbotConversation = document.getElementById('chatbot-conversation-container')
        const question = userInput.value

        try {
            // Clear input and show user message
            userInput.value = ''
            this.appendMessage(chatbotConversation, question, 'human')
            const aiMessage = this.appendMessage(chatbotConversation, 'Thinking...', 'ai')

            // Get AI response and update message
            const response = await this.chatManager.processUserInput(question)
            aiMessage.innerHTML = response
        } catch (error) {
            console.error('Error in conversation:', error)
            const errorMessage = 'Sorry, I encountered an error. Please try again.'
            if (aiMessage) {
                aiMessage.textContent = errorMessage
            } else {
                this.appendMessage(chatbotConversation, errorMessage, 'ai')
            }
        }
    }

    /**
     * Append a message to the chat container
     * @param {HTMLElement} container - The chat container element
     * @param {string} text - The message text
     * @param {string} type - The type of message ('human', 'ai', or 'error')
     * @returns {HTMLElement} The created message element
     */
    appendMessage(container, text, type) {
        const speechBubble = document.createElement('div')
        speechBubble.classList.add('speech', `speech-${type}`)
        speechBubble.textContent = text
        container.appendChild(speechBubble)
        container.scrollTop = container.scrollHeight
        return speechBubble
    }
}
// Create an instance of the App class to start the application
new App()
