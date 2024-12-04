document.addEventListener('submit', (e) => {
    e.preventDefault()
    progressConversation()
})

import { rateLimiter } from './rateLimit.js'
import { RecursiveCharacterTextSplitter } from 'langchain/text_splitter'
import { createClient } from '@supabase/supabase-js'

const openAIApiKey = import.meta.env.VITE_OPENAI_API_KEY
let documentChunks = []
let isDataProcessed = false;

// Initialize Supabase client
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_API_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

async function checkExistingDocuments() {
    try {
        const { data, error } = await supabase
            .from('documents')
            .select('metadata')
            .order('metadata->chunkIndex', { ascending: false })
            .limit(1);

        if (error) throw error;

        if (data && data.length > 0) {
            // Return both the existence status and the last processed chunk index
            return {
                hasDocuments: true,
                lastProcessedIndex: data[0].metadata.chunkIndex
            };
        }

        return {
            hasDocuments: false,
            lastProcessedIndex: -1
        };
    } catch (error) {
        console.error('Error checking existing documents:', error);
        return {
            hasDocuments: false,
            lastProcessedIndex: -1
        };
    }
}

async function initialize() {
    try {
        const chatbotConversation = document.getElementById('chatbot-conversation-container');
        
        // Check if documents are already processed
        const { hasDocuments, lastProcessedIndex } = await checkExistingDocuments();
        
        if (hasDocuments && lastProcessedIndex >= 0) {
            // Get total expected chunks
            const response = await fetch('./scrimba-info.txt');
            const text = await response.text();
            const splitter = new RecursiveCharacterTextSplitter({
                chunkSize: 500,
                separators: ['\n\n', '\n', ' ', ''],
                chunkOverlap: 50
            });
            const expectedChunks = (await splitter.createDocuments([text])).length;
            
            if (lastProcessedIndex + 1 === expectedChunks) {
                console.log('All documents processed. Ready for questions!');
                appendMessage(
                    chatbotConversation,
                    "Hi! I'm ready to answer your questions about Scrimba. What would you like to know?",
                    'ai'
                );
            } else {
                console.log('Partial processing detected. Resuming...');
                appendMessage(
                    chatbotConversation,
                    "Resuming previous processing...",
                    'ai'
                );
                
                const processingMessage = appendMessage(
                    chatbotConversation,
                    `Resuming from chunk ${lastProcessedIndex + 1}/${expectedChunks}`,
                    'status'
                );
                
                window.addEventListener('processingUpdate', (e) => {
                    processingMessage.textContent = `Processing: ${e.detail.current}/${e.detail.total} chunks${e.detail.resuming ? ' (Resumed)' : ''}`;
                });
                
                await processTextFile();
                processingMessage.textContent = "Processing complete! You can now ask questions.";
            }
        } else {
            console.log('Starting initial document processing...');
            appendMessage(
                chatbotConversation,
                "Please wait while I process the documentation...",
                'ai'
            );
            
            const processingMessage = appendMessage(
                chatbotConversation,
                "Processing: 0/0 chunks",
                'status'
            );
            
            // Add event listener for processing updates
            window.addEventListener('processingUpdate', (e) => {
                processingMessage.textContent = `Processing: ${e.detail.current}/${e.detail.total} chunks`;
            });
            
            await processTextFile();
            
            // Update status once complete
            processingMessage.textContent = "Processing complete! You can now ask questions.";
            isDataProcessed = true;
        }
    } catch (error) {
        console.error('Initialization error:', error);
        appendMessage(
            chatbotConversation,
            "Sorry, I encountered an error during initialization. Please refresh the page to try again.",
            'error'
        );
    }
}

async function progressConversation() {
    const userInput = document.getElementById('user-input')
    const chatbotConversation = document.getElementById('chatbot-conversation-container')
    const question = userInput.value
    
    try {
        // Clear input early to prevent double submissions
        userInput.value = ''
        
        // Add human message
        appendMessage(chatbotConversation, question, 'human')
        
        // Show loading state
        const aiMessage = appendMessage(chatbotConversation, 'Thinking...', 'ai')
        
        // Wait for rate limiter before making API call
        await rateLimiter.waitForToken()
        
        // TODO: Implement your API call here
        const response = await fetchAIResponse(question)
        
        // Update AI message with response
        aiMessage.textContent = response
    } catch (error) {
        console.error('Error in conversation:', error)
        // Show error to user
        const errorMessage = 'Sorry, I encountered an error. Please try again.'
        if (aiMessage) {
            aiMessage.textContent = errorMessage
        } else {
            appendMessage(chatbotConversation, errorMessage, 'ai')
        }
    }
}

function appendMessage(container, text, type) {
    const speechBubble = document.createElement('div')
    speechBubble.classList.add('speech', `speech-${type}`)
    speechBubble.textContent = text
    container.appendChild(speechBubble)
    container.scrollTop = container.scrollHeight
    return speechBubble
}

async function processTextFile() {
    let processedCount = 0;
    
    try {
        console.log('Starting text file processing...');

        // Check existing progress
        const { lastProcessedIndex } = await checkExistingDocuments();
        console.log(`Last processed chunk index: ${lastProcessedIndex}`);

        const response = await fetch('./scrimba-info.txt');
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        const text = await response.text();

        console.log('File read successfully, starting text splitting...');

        const splitter = new RecursiveCharacterTextSplitter({
            chunkSize: 500,
            separators: ['\n\n', '\n', ' ', ''],
            chunkOverlap: 50
        });

        documentChunks = await splitter.createDocuments([text]);
        const totalChunks = documentChunks.length;

        // If we have partial processing, update the user
        if (lastProcessedIndex >= 0) {
            console.log(`Resuming from chunk ${lastProcessedIndex + 1}/${totalChunks}`);
            processedCount = lastProcessedIndex + 1;
        }
        
        // Dispatch initial progress event
        window.dispatchEvent(new CustomEvent('processingUpdate', {
            detail: { 
                current: processedCount, 
                total: totalChunks,
                resuming: lastProcessedIndex >= 0 
            }
        }));

        // Process each remaining chunk
        for (let i = lastProcessedIndex + 1; i < documentChunks.length; i++) {
            const chunk = documentChunks[i];
            try {
                if (i > lastProcessedIndex + 1) {
                    await new Promise(resolve => setTimeout(resolve, 2000));
                }
                
                // Check if this chunk already exists
                const { data: existingChunk } = await supabase
                    .from('documents')
                    .select('id')
                    .eq('metadata->chunkIndex', i)
                    .maybeSingle();

                if (existingChunk) {
                    console.log(`Chunk ${i} already exists, skipping...`);
                    processedCount++;
                    continue;
                }

                const embedding = await generateEmbedding(chunk.pageContent);
                
                const metadata = {
                    source: 'scrimba-info.txt',
                    chunkIndex: i,
                    length: chunk.pageContent.length,
                    timestamp: new Date().toISOString()
                };

                const { error } = await supabase
                    .from('documents')
                    .insert([{
                        content: chunk.pageContent,
                        metadata: metadata,
                        embedding: embedding
                    }]);

                if (error) throw error;

                processedCount++;
                
                // Dispatch progress event
                window.dispatchEvent(new CustomEvent('processingUpdate', {
                    detail: { 
                        current: processedCount, 
                        total: totalChunks,
                        resuming: lastProcessedIndex >= 0 
                    }
                }));

            } catch (chunkError) {
                console.error(`Error processing chunk ${i}:`, chunkError);
                continue;
            }
        }

        // Verify all chunks are processed
        const { count: finalCount } = await supabase
            .from('documents')
            .select('*', { count: 'exact', head: true });

        const isComplete = finalCount === totalChunks;
        console.log(`Processing ${isComplete ? 'complete' : 'incomplete'}. Processed ${finalCount}/${totalChunks} chunks`);
        
        return isComplete;

    } catch (err) {
        console.error('An error occurred during text processing:', err);
        throw err;
    }
}

async function generateEmbedding(text, retryCount = 0) {
    const MAX_RETRIES = 3;
    const RATE_LIMIT_RETRY_DELAY = 20000; // 20 seconds as suggested by the API

    try {
        console.log('Waiting for rate limiter token...');
        await rateLimiter.waitForToken()
        console.log('Token received, proceeding with embedding generation...');

        const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${openAIApiKey}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                input: text,
                model: 'text-embedding-ada-002'
            })
        })

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            
            // Handle rate limit error specifically
            if (response.status === 429 && retryCount < MAX_RETRIES) {
                const waitTimeSeconds = RATE_LIMIT_RETRY_DELAY/1000;
                console.log(`⏳ Rate limit reached. Attempt ${retryCount + 1}/${MAX_RETRIES}`);
                console.log(`Waiting ${waitTimeSeconds} seconds before retrying...`);
                
                await new Promise((resolve, reject) => {
                    // Set up an interval to show a countdown
                    const intervalId = setInterval(() => {
                        const remainingSeconds = Math.ceil((RATE_LIMIT_RETRY_DELAY - (Date.now() - startTime)) / 1000);
                        console.log(`⏱️ ${remainingSeconds} seconds remaining...`);
                    }, 5000); // Update every 5 seconds
                    
                    const startTime = Date.now();
                    setTimeout(() => {
                        clearInterval(intervalId);
                        console.log('Retry wait complete, attempting embedding generation again...');
                        resolve();
                    }, RATE_LIMIT_RETRY_DELAY);
                });
                
                return generateEmbedding(text, retryCount + 1);
            }
            
            throw new Error(`OpenAI API error: ${response.statusText}. ${JSON.stringify(errorData)}`);
        }

        const json = await response.json()
        return json.data[0].embedding
    } catch (error) {
        console.error('Error generating embedding:', error)
        throw error
    }
}

// TODO: Implement API call function
async function fetchAIResponse(question) {
    // Implement your API call here using openAIApiKey
    // Return the response text
    throw new Error('fetchAIResponse not implemented')
}

// Initialize
initialize();