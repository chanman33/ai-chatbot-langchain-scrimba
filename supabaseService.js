import { createClient } from '@supabase/supabase-js'

export class SupabaseService {
    constructor(config) {
        this.client = createClient(config.supabaseUrl, config.supabaseKey)
    }

    async checkExistingDocuments() {
        try {
            const { data, error } = await this.client
                .from('documents')
                .select('metadata')
                .order('metadata->chunkIndex', { ascending: false })
                .limit(1)

            if (error) throw error

            return {
                hasDocuments: data?.length > 0,
                lastProcessedIndex: data?.[0]?.metadata?.chunkIndex ?? -1
            }
        } catch (error) {
            console.error('Error checking existing documents:', error)
            return { hasDocuments: false, lastProcessedIndex: -1 }
        }
    }

    async checkExistingChunk(index) {
        const { data: existingChunk } = await this.client
            .from('documents')
            .select('id')
            .eq('metadata->chunkIndex', index)
            .maybeSingle()
        
        return existingChunk
    }

    async insertChunk(processedChunk, index) {
        return await this.client
            .from('documents')
            .insert([{
                content: processedChunk.content,
                metadata: {
                    source: 'scrimba-info.txt',
                    chunkIndex: index,
                    length: processedChunk.content.length,
                    timestamp: new Date().toISOString()
                },
                embedding: processedChunk.embedding
            }])
    }

    async getDocumentCount() {
        const { count } = await this.client
            .from('documents')
            .select('*', { count: 'exact', head: true })
        
        return count
    }

    // Add other Supabase-related methods here
}
