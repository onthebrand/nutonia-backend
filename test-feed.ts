import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
    console.log('Querying content...');
    const { data: allContent, error: err1 } = await supabase.from('content').select('id, topic, is_public').limit(10);
    console.log('All Content. Error:', err1, 'Data:', allContent);
    
    const { data: publicContent, error: err2 } = await supabase.from('content').select('id, topic, is_public').eq('is_public', true).limit(10);
    console.log('Public Content. Error:', err2, 'Data:', publicContent);
}

main();
