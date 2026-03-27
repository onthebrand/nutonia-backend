-- Helper functions for common operations

-- Increment shares count
CREATE OR REPLACE FUNCTION increment_shares(content_id UUID)
RETURNS VOID AS $$
BEGIN
  UPDATE content
  SET shares = shares + 1
  WHERE id = content_id;
END;
$$ LANGUAGE plpgsql;

-- Increment credits
CREATE OR REPLACE FUNCTION increment_credits(user_id UUID, amount INTEGER)
RETURNS VOID AS $$
BEGIN
  UPDATE users
  SET credits = credits + amount
  WHERE id = user_id;
END;
$$ LANGUAGE plpgsql;

-- Decrement credits (for generation)
CREATE OR REPLACE FUNCTION decrement_credits(user_id UUID, amount INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
  current_credits INTEGER;
BEGIN
  SELECT credits INTO current_credits
  FROM users
  WHERE id = user_id;
  
  IF current_credits >= amount THEN
    UPDATE users
    SET credits = credits - amount
    WHERE id = user_id;
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$$ LANGUAGE plpgsql;
