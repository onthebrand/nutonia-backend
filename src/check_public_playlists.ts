
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

// Load env vars
dotenv.config({ path: '../../.env' }); // Assuming running from backend/src or similar, actually let's just try to find it.
// Better: just load from process.cwd() if possible, or relative to this file.
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
    console.error('Missing Supabase environment variables');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function checkPublicPlaylists() {
    console.log('Checking public playlists...');

    const { data, error } = await supabase
        .from('playlists')
        .select('*')
        .eq('is_public', true);

    if (error) {
        console.error('Error fetching playlists:', error);
    } else {
        console.log(`Found ${data.length} public playlists:`);
        data.forEach(p => {
            console.log(`- [${p.id}] ${p.title} (Creator: ${p.creator_id})`);
        });
    }
}

checkPublicPlaylists();
