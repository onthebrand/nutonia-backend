
import { supabaseAdmin } from '../src/config/supabase';

async function listUsers() {
    console.log(`Listing all users...`);

    const { data: users, error } = await supabaseAdmin
        .from('users')
        .select('id, email, username');

    if (error) {
        console.error('Failed to fetch users.');
        console.error(error);
        return;
    }

    console.log(`Found ${users.length} users:`);
    users.forEach(u => console.log(`- ${u.email} (${u.username})`));
}

listUsers();
