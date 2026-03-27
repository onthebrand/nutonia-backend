
import { supabaseAdmin } from '../src/config/supabase';

async function forceGrantSuperadmin(email: string) {
    console.log(`Force granting superadmin to ${email}...`);

    // 1. Get Auth User
    const { data: { users }, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    if (authError) {
        console.error('Failed to list auth users:', authError);
        return;
    }

    const authUser = users.find(u => u.email === email);
    if (!authUser) {
        console.error('User not found in Supabase Auth.');
        return;
    }
    console.log(`Found Auth User: ${authUser.id}`);

    // 2. Check Public User
    const { data: publicUser, error: fetchError } = await supabaseAdmin
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .single();

    if (!publicUser) {
        console.log('Public user record missing. Creating it now...');
        const { error: insertError } = await supabaseAdmin
            .from('users')
            .insert({
                id: authUser.id,
                email: email,
                username: email.split('@')[0],
                credits: 0,
                role: 'USER'
            });

        if (insertError) {
            console.error('Failed to create public user:', insertError);
            return;
        }
        console.log('Public user created.');
    } else {
        console.log('Public user record exists.');
    }

    // 3. Update Privileges
    console.log('Updating privileges...');
    const { error: updateError } = await supabaseAdmin
        .from('users')
        .update({
            role: 'ADMIN',
            credits: 9999999
        })
        .eq('id', authUser.id);

    if (updateError) {
        console.error('Failed to update privileges:', updateError);
        return;
    }

    console.log('SUCCESS: User is now a Superadmin with unlimited Nutons.');
}

forceGrantSuperadmin('o.morabacho@gmail.com');
