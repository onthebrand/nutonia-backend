
import { supabaseAdmin } from '../src/config/supabase';

async function listAuthUsers() {
    console.log(`Listing Supabase Auth users...`);

    const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();

    if (error) {
        console.error('Failed to fetch auth users.');
        console.error(error);
        return;
    }

    console.log(`Found ${users.length} auth users:`);
    users.forEach(u => console.log(`- ${u.email} (${u.id})`));
}

listAuthUsers();
