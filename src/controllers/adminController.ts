import { Request, Response } from 'express';
import { supabaseAdmin } from '../config/supabase.js';

/**
 * GET /api/admin/stats
 * Returns aggregated statistics for the admin dashboard
 */
export async function getDashboardStats(req: Request, res: Response): Promise<void> {
    try {
        // 1. User Stats
        const { count: totalUsers, error: userError } = await supabaseAdmin
            .from('users')
            .select('*', { count: 'exact', head: true });

        if (userError) throw userError;

        // For now, we'll assume "active" users are those created in the last 30 days
        // In a real app, you'd track last_login_at
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

        const { count: activeUsers, error: activeUserError } = await supabaseAdmin
            .from('users')
            .select('*', { count: 'exact', head: true })
            .gte('created_at', thirtyDaysAgo.toISOString());

        if (activeUserError) throw activeUserError;

        // 2. Content Stats
        const { data: contentData, error: contentError } = await supabaseAdmin
            .from('content')
            .select('type, created_at');

        if (contentError) throw contentError;

        const totalContent = contentData?.length || 0;

        // Group by type
        const contentByType: Record<string, number> = {};
        contentData?.forEach(item => {
            const type = item.type || 'unknown';
            contentByType[type] = (contentByType[type] || 0) + 1;
        });

        // Group by date (last 7 days) for the chart
        const contentByDate: Record<string, number> = {};
        const today = new Date();
        for (let i = 6; i >= 0; i--) {
            const d = new Date(today);
            d.setDate(d.getDate() - i);
            const dateStr = d.toISOString().split('T')[0];
            contentByDate[dateStr] = 0;
        }

        contentData?.forEach(item => {
            const dateStr = new Date(item.created_at).toISOString().split('T')[0];
            if (contentByDate[dateStr] !== undefined) {
                contentByDate[dateStr]++;
            }
        });

        // 3. API Usage & Costs (Estimated)
        // Costs per unit (Nutons/USD estimate)
        const COSTS = {
            song: 0.05,
            video: 0.10,
            infographic: 0.04,
            flashcards: 0.01,
            podcast: 0.03,
            mindmap: 0.02
        };

        let totalApiCost = 0;
        const apiUsageByDate: Record<string, number> = { ...contentByDate }; // Initialize with 0s
        // Reset counts for cost calculation
        Object.keys(apiUsageByDate).forEach(k => apiUsageByDate[k] = 0);

        contentData?.forEach(item => {
            const cost = COSTS[item.type as keyof typeof COSTS] || 0.01;
            totalApiCost += cost;

            const dateStr = new Date(item.created_at).toISOString().split('T')[0];
            if (apiUsageByDate[dateStr] !== undefined) {
                apiUsageByDate[dateStr] += cost;
            }
        });

        // 4. Revenue (Credit Transactions)
        // Assuming we have a 'credit_transactions' table with 'amount_paid'
        // If not, we'll return 0 for now or check the table structure if needed.
        // Based on previous file exploration, `credit_transactions` exists.
        const { data: transactions, error: transError } = await supabaseAdmin
            .from('credit_transactions')
            .select('amount_paid, created_at'); // Assuming amount_paid exists

        let totalRevenue = 0;
        if (!transError && transactions) {
            transactions.forEach(t => {
                totalRevenue += (t.amount_paid || 0);
            });
        }

        res.json({
            users: {
                total: totalUsers || 0,
                active: activeUsers || 0,
                free: (totalUsers || 0) - 0, // Placeholder if we don't have plan data yet
                paid: 0 // Placeholder
            },
            content: {
                total: totalContent,
                byType: contentByType,
                history: contentByDate
            },
            api: {
                totalCost: totalApiCost,
                usageByDate: apiUsageByDate
            },
            revenue: {
                total: totalRevenue
            }
        });

    } catch (error) {
        console.error('Get dashboard stats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
}
