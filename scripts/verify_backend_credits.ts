
import { supabaseAdmin } from '../src/config/supabase';

async function verifyBackendCredits(email: string) {
    console.log(`Verifying credits for ${email}...`);

    // 1. Get User ID
    const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError || !users) {
        console.error('Failed to list auth users:', authError);
        return;
    }
    const authUser = users.find(u => u.email === email);
    if (!authUser) {
        console.error('User not found in Supabase Auth.');
        return;
    }

    // 2. Query Public User Table (Simulating what authController does)
    const { data: profile, error: fetchError } = await supabaseAdmin
        .from('users')
        .select('id, email, username, credits, role')
        .eq('id', authUser.id)
        .single();

    if (fetchError) {
        console.error('Failed to fetch public user profile:', fetchError);
        return;
    }

    console.log('Backend Profile Data:');
    console.log(`- ID: ${profile.id}`);
    console.log(`- Email: ${profile.email}`);
    console.log(`- Role: ${profile.role}`);
    console.log(`- Credits: ${profile.credits}`);

    if (profile.credits === 9999999) {
        console.log('SUCCESS: Backend has correct credits.');
    } else {
        console.error('FAILURE: Backend has incorrect credits.');
    }
}

verifyBackendCredits('o.morabacho@gmail.com');
