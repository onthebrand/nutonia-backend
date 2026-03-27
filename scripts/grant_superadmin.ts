
import { supabaseAdmin } from '../src/config/supabase';

async function grantSuperadmin(email: string) {
    console.log(`Granting superadmin privileges to ${email}...`);

    // 1. Check if user exists
    const { data: user, error: fetchError } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('email', email)
        .single();

    if (fetchError || !user) {
        console.error(`User with email ${email} not found.`);
        console.error(fetchError);
        return;
    }

    console.log(`Found user: ${user.username} (${user.id})`);

    // 2. Update user privileges
    const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({
            role: 'ADMIN',
            plan: 'ORG',
            credits: 9999999 // Unlimited Nutons
        })
        .eq('id', user.id);

    if (updateError) {
        console.error('Failed to update user privileges.');
        console.error(updateError);
        return;
    }

    console.log('Successfully granted superadmin privileges!');
    console.log('New Role: ADMIN');
    console.log('New Plan: ORG');
    console.log('New Credits: 9999999');
}

const targetEmail = 'o.morabacho@gmail.com';
grantSuperadmin(targetEmail);
