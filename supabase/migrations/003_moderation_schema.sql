-- Content Moderation System Schema
-- This migration adds tables and functions for content moderation

-- Content moderation flags table
-- Stores both pre-generation and post-generation moderation decisions
CREATE TABLE IF NOT EXISTS content_moderation_flags (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content_id UUID REFERENCES content(id) ON DELETE CASCADE, -- NULL for pre-generation flags
  prompt TEXT NOT NULL, -- The original prompt/question
  flag_type TEXT NOT NULL CHECK (flag_type IN ('PRE_GENERATION', 'POST_GENERATION', 'USER_REPORT')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'REVIEWED')),
  
  -- AI Analysis Results
  is_appropriate BOOLEAN NOT NULL,
  confidence_score DECIMAL(3,2), -- 0.00 to 1.00
  violated_categories JSONB DEFAULT '[]'::jsonb, -- Array of category names
  ai_reasoning TEXT, -- Explanation from AI
  
  -- Admin Review
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  admin_notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User-submitted content reports
CREATE TABLE IF NOT EXISTS content_reports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reporter_id UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL if anonymous
  content_id UUID NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN (
    'SEXUAL_CONTENT',
    'DRUGS',
    'VIOLENCE',
    'ADVERTISING',
    'POLITICAL',
    'RELIGIOUS',
    'HATE_SPEECH',
    'SPAM',
    'OTHER'
  )),
  description TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'REVIEWING', 'RESOLVED', 'DISMISSED')),
  
  -- Admin Review
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMP WITH TIME ZONE,
  resolution_notes TEXT,
  action_taken TEXT, -- 'CONTENT_REMOVED', 'USER_WARNED', 'USER_SUSPENDED', 'NO_ACTION'
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User violations tracking
CREATE TABLE IF NOT EXISTS user_violations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  violation_type TEXT NOT NULL CHECK (violation_type IN (
    'INAPPROPRIATE_PROMPT',
    'INAPPROPRIATE_CONTENT',
    'REPEATED_VIOLATIONS',
    'SPAM',
    'ABUSE'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
  
  -- Reference to the flag or report that triggered this violation
  moderation_flag_id UUID REFERENCES content_moderation_flags(id) ON DELETE SET NULL,
  content_report_id UUID REFERENCES content_reports(id) ON DELETE SET NULL,
  
  description TEXT NOT NULL,
  
  -- Suspension info
  suspension_duration_hours INTEGER, -- NULL if no suspension
  suspension_start TIMESTAMP WITH TIME ZONE,
  suspension_end TIMESTAMP WITH TIME ZONE,
  
  -- Admin info
  issued_by UUID REFERENCES users(id) ON DELETE SET NULL, -- NULL if auto-generated
  admin_notes TEXT,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- User suspension status (denormalized for quick checks)
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS suspension_end TIMESTAMP WITH TIME ZONE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS violation_count INTEGER DEFAULT 0;

-- Moderation configuration/policies
CREATE TABLE IF NOT EXISTS moderation_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  category TEXT UNIQUE NOT NULL,
  enabled BOOLEAN DEFAULT true,
  strictness_level TEXT DEFAULT 'BALANCED' CHECK (strictness_level IN ('STRICT', 'BALANCED', 'PERMISSIVE')),
  auto_block BOOLEAN DEFAULT true, -- Auto-block or just flag for review
  keywords JSONB DEFAULT '[]'::jsonb, -- Keywords to watch for
  description TEXT,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Insert default moderation policies
INSERT INTO moderation_policies (category, strictness_level, auto_block, description) VALUES
  ('SEXUAL_CONTENT', 'BALANCED', true, 'Contenido sexual explícito o inapropiado'),
  ('DRUGS', 'BALANCED', true, 'Contenido sobre drogas ilegales o abuso de sustancias'),
  ('VIOLENCE', 'BALANCED', true, 'Contenido violento o que promueva daño'),
  ('ADVERTISING', 'STRICT', true, 'Publicidad comercial o promoción de productos'),
  ('POLITICAL', 'BALANCED', false, 'Propaganda política partidista'),
  ('RELIGIOUS', 'BALANCED', false, 'Proselitismo religioso'),
  ('HATE_SPEECH', 'STRICT', true, 'Discurso de odio o discriminación')
ON CONFLICT (category) DO NOTHING;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_moderation_flags_user ON content_moderation_flags(user_id);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_content ON content_moderation_flags(content_id);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_status ON content_moderation_flags(status);
CREATE INDEX IF NOT EXISTS idx_moderation_flags_created ON content_moderation_flags(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_content_reports_content ON content_reports(content_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_reporter ON content_reports(reporter_id);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports(status);
CREATE INDEX IF NOT EXISTS idx_content_reports_created ON content_reports(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_violations_user ON user_violations(user_id);
CREATE INDEX IF NOT EXISTS idx_user_violations_created ON user_violations(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_users_suspended ON users(is_suspended) WHERE is_suspended = true;

-- Trigger to update updated_at timestamp
CREATE TRIGGER update_moderation_flags_updated_at 
  BEFORE UPDATE ON content_moderation_flags 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_content_reports_updated_at 
  BEFORE UPDATE ON content_reports 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_moderation_policies_updated_at 
  BEFORE UPDATE ON moderation_policies 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Helper function to check if user is suspended
CREATE OR REPLACE FUNCTION is_user_suspended(user_id_param UUID)
RETURNS BOOLEAN AS $$
DECLARE
  suspended BOOLEAN;
  suspension_end_time TIMESTAMP WITH TIME ZONE;
BEGIN
  SELECT is_suspended, suspension_end INTO suspended, suspension_end_time
  FROM users
  WHERE id = user_id_param;
  
  -- If not suspended, return false
  IF NOT suspended THEN
    RETURN false;
  END IF;
  
  -- If suspension has expired, update user and return false
  IF suspension_end_time IS NOT NULL AND suspension_end_time < NOW() THEN
    UPDATE users
    SET is_suspended = false, suspension_end = NULL
    WHERE id = user_id_param;
    RETURN false;
  END IF;
  
  -- User is currently suspended
  RETURN true;
END;
$$ LANGUAGE plpgsql;

-- Helper function to suspend user
CREATE OR REPLACE FUNCTION suspend_user(
  user_id_param UUID,
  duration_hours INTEGER,
  violation_id_param UUID DEFAULT NULL,
  admin_id_param UUID DEFAULT NULL
)
RETURNS VOID AS $$
DECLARE
  suspension_end_time TIMESTAMP WITH TIME ZONE;
BEGIN
  suspension_end_time := NOW() + (duration_hours || ' hours')::INTERVAL;
  
  UPDATE users
  SET 
    is_suspended = true,
    suspension_end = suspension_end_time,
    violation_count = violation_count + 1
  WHERE id = user_id_param;
  
  -- Update the violation record if provided
  IF violation_id_param IS NOT NULL THEN
    UPDATE user_violations
    SET 
      suspension_duration_hours = duration_hours,
      suspension_start = NOW(),
      suspension_end = suspension_end_time
    WHERE id = violation_id_param;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Helper function to record a violation
CREATE OR REPLACE FUNCTION record_violation(
  user_id_param UUID,
  violation_type_param TEXT,
  severity_param TEXT,
  description_param TEXT,
  moderation_flag_id_param UUID DEFAULT NULL,
  auto_suspend BOOLEAN DEFAULT true
)
RETURNS UUID AS $$
DECLARE
  violation_id UUID;
  current_violation_count INTEGER;
  suspension_hours INTEGER;
BEGIN
  -- Insert violation
  INSERT INTO user_violations (
    user_id,
    violation_type,
    severity,
    description,
    moderation_flag_id
  ) VALUES (
    user_id_param,
    violation_type_param,
    severity_param,
    description_param,
    moderation_flag_id_param
  ) RETURNING id INTO violation_id;
  
  -- Get current violation count
  SELECT violation_count INTO current_violation_count
  FROM users
  WHERE id = user_id_param;
  
  -- Auto-suspend logic based on violation count and severity
  IF auto_suspend THEN
    suspension_hours := CASE
      WHEN severity_param = 'CRITICAL' THEN 168 -- 7 days
      WHEN severity_param = 'HIGH' AND current_violation_count >= 2 THEN 72 -- 3 days
      WHEN severity_param = 'MEDIUM' AND current_violation_count >= 3 THEN 24 -- 1 day
      WHEN current_violation_count >= 5 THEN 24 -- 1 day after 5 violations
      ELSE NULL
    END;
    
    IF suspension_hours IS NOT NULL THEN
      PERFORM suspend_user(user_id_param, suspension_hours, violation_id, NULL);
    END IF;
  END IF;
  
  RETURN violation_id;
END;
$$ LANGUAGE plpgsql;

-- RLS Policies
ALTER TABLE content_moderation_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE moderation_policies ENABLE ROW LEVEL SECURITY;

-- Users can view their own moderation flags
CREATE POLICY moderation_flags_select_own ON content_moderation_flags 
  FOR SELECT USING (user_id = auth.uid());

-- Users can view their own violations
CREATE POLICY user_violations_select_own ON user_violations 
  FOR SELECT USING (user_id = auth.uid());

-- Users can submit reports
CREATE POLICY content_reports_insert_own ON content_reports 
  FOR INSERT WITH CHECK (reporter_id = auth.uid() OR reporter_id IS NULL);

-- Users can view their own reports
CREATE POLICY content_reports_select_own ON content_reports 
  FOR SELECT USING (reporter_id = auth.uid());

-- Everyone can read moderation policies
CREATE POLICY moderation_policies_select_all ON moderation_policies 
  FOR SELECT USING (true);

-- Admin policies (admins can see and modify everything)
-- Note: Admin role check should be implemented in application layer
-- These policies allow admins with role='ADMIN' to access all records

CREATE POLICY moderation_flags_admin_all ON content_moderation_flags 
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'ADMIN')
  );

CREATE POLICY content_reports_admin_all ON content_reports 
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'ADMIN')
  );

CREATE POLICY user_violations_admin_all ON user_violations 
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'ADMIN')
  );

CREATE POLICY moderation_policies_admin_all ON moderation_policies 
  FOR ALL USING (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'ADMIN')
  );
