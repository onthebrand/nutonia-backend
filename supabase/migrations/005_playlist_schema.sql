-- Create helper function for updated_at timestamps if it doesn't exist
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create playlists table
CREATE TABLE IF NOT EXISTS public.playlists (
    id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
    creator_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    cover_url TEXT,
    category TEXT DEFAULT 'DIDACTIC',
    is_public BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Create playlist items table (Join table)
CREATE TABLE IF NOT EXISTS public.playlist_items (
    playlist_id UUID REFERENCES public.playlists(id) ON DELETE CASCADE,
    content_id UUID REFERENCES public.content(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    added_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    PRIMARY KEY (playlist_id, content_id)
);

-- RLS Policies for playlists
ALTER TABLE public.playlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view public playlists" 
    ON public.playlists FOR SELECT 
    USING (is_public = true OR auth.uid() = creator_id);

CREATE POLICY "Users can insert their own playlists" 
    ON public.playlists FOR INSERT 
    WITH CHECK (auth.uid() = creator_id);

CREATE POLICY "Users can update their own playlists" 
    ON public.playlists FOR UPDATE 
    USING (auth.uid() = creator_id);

CREATE POLICY "Users can delete their own playlists" 
    ON public.playlists FOR DELETE 
    USING (auth.uid() = creator_id);

-- RLS Policies for playlist_items
ALTER TABLE public.playlist_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view items of accessible playlists" 
    ON public.playlist_items FOR SELECT 
    USING (
        EXISTS (
            SELECT 1 FROM public.playlists p 
            WHERE p.id = playlist_items.playlist_id 
            AND (p.is_public = true OR p.creator_id = auth.uid())
        )
    );

CREATE POLICY "Playlist owners can manage items" 
    ON public.playlist_items FOR ALL 
    USING (
        EXISTS (
            SELECT 1 FROM public.playlists p 
            WHERE p.id = playlist_items.playlist_id 
            AND p.creator_id = auth.uid()
        )
    );

-- Trigger for updated_at
DROP TRIGGER IF EXISTS update_playlists_modtime ON public.playlists;
CREATE TRIGGER update_playlists_modtime
    BEFORE UPDATE ON public.playlists
    FOR EACH ROW EXECUTE PROCEDURE update_modified_column();
