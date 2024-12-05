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

    // Add other Supabase-related methods here
}
