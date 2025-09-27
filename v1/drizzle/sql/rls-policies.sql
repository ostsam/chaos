-- Enable Row Level Security (RLS) on all sensitive tables
-- This ensures users can only access data they're authorized to see

-- ============================================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================================

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "conversations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "participants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "message_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "accounts" ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- USERS TABLE POLICIES
-- ============================================================================

-- Users can only see their own user record
CREATE POLICY "users_own_record" ON "users"
    FOR ALL
    USING (id = current_setting('app.current_user_id', true));

-- Users can see other users' public information (for chat participant lists, etc.)
CREATE POLICY "users_public_info" ON "users"
    FOR SELECT
    USING (true); -- Allow reading public user info for chat functionality

-- ============================================================================
-- CONVERSATIONS TABLE POLICIES
-- ============================================================================

-- Users can only see conversations they participate in
CREATE POLICY "conversations_participant_access" ON "conversations"
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM "participants" p 
            WHERE p."conversationId" = id 
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- ============================================================================
-- PARTICIPANTS TABLE POLICIES
-- ============================================================================

-- Users can see participants in conversations they're part of
CREATE POLICY "participants_conversation_access" ON "participants"
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM "participants" p 
            WHERE p."conversationId" = "conversationId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- ============================================================================
-- MESSAGES TABLE POLICIES
-- ============================================================================

-- Users can see messages in conversations they participate in
CREATE POLICY "messages_conversation_access" ON "messages"
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "participants" p 
            WHERE p."conversationId" = "conversationId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- Users can only insert messages to conversations they participate in
CREATE POLICY "messages_insert_participant" ON "messages"
    FOR INSERT
    WITH CHECK (
        "senderId" = current_setting('app.current_user_id', true)
        AND EXISTS (
            SELECT 1 FROM "participants" p 
            WHERE p."conversationId" = "conversationId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- Users can only update their own messages
CREATE POLICY "messages_update_own" ON "messages"
    FOR UPDATE
    USING ("senderId" = current_setting('app.current_user_id', true))
    WITH CHECK ("senderId" = current_setting('app.current_user_id', true));

-- Users can only delete their own messages
CREATE POLICY "messages_delete_own" ON "messages"
    FOR DELETE
    USING ("senderId" = current_setting('app.current_user_id', true));

-- ============================================================================
-- ATTACHMENTS TABLE POLICIES
-- ============================================================================

-- Users can see attachments for messages they can see
CREATE POLICY "attachments_message_access" ON "attachments"
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM "messages" m 
            JOIN "participants" p ON p."conversationId" = m."conversationId"
            WHERE m.id = "messageId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- ============================================================================
-- REACTIONS TABLE POLICIES
-- ============================================================================

-- Users can see reactions on messages they can see
CREATE POLICY "reactions_message_access" ON "reactions"
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "messages" m 
            JOIN "participants" p ON p."conversationId" = m."conversationId"
            WHERE m.id = "messageId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- Users can only create their own reactions
CREATE POLICY "reactions_insert_own" ON "reactions"
    FOR INSERT
    WITH CHECK (
        "userId" = current_setting('app.current_user_id', true)
        AND EXISTS (
            SELECT 1 FROM "messages" m 
            JOIN "participants" p ON p."conversationId" = m."conversationId"
            WHERE m.id = "messageId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- Users can only delete their own reactions
CREATE POLICY "reactions_delete_own" ON "reactions"
    FOR DELETE
    USING ("userId" = current_setting('app.current_user_id', true));

-- ============================================================================
-- MESSAGE RECEIPTS TABLE POLICIES
-- ============================================================================

-- Users can see receipts for messages they can see
CREATE POLICY "receipts_message_access" ON "message_receipts"
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM "messages" m 
            JOIN "participants" p ON p."conversationId" = m."conversationId"
            WHERE m.id = "messageId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- Users can only create receipts for themselves
CREATE POLICY "receipts_insert_own" ON "message_receipts"
    FOR INSERT
    WITH CHECK (
        "userId" = current_setting('app.current_user_id', true)
        AND EXISTS (
            SELECT 1 FROM "messages" m 
            JOIN "participants" p ON p."conversationId" = m."conversationId"
            WHERE m.id = "messageId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- Users can only update their own receipts
CREATE POLICY "receipts_update_own" ON "message_receipts"
    FOR UPDATE
    USING ("userId" = current_setting('app.current_user_id', true))
    WITH CHECK ("userId" = current_setting('app.current_user_id', true));

-- ============================================================================
-- SESSIONS TABLE POLICIES (NextAuth)
-- ============================================================================

-- Users can only access their own sessions
CREATE POLICY "sessions_own_access" ON "sessions"
    FOR ALL
    USING ("userId" = current_setting('app.current_user_id', true));

-- ============================================================================
-- ACCOUNTS TABLE POLICIES (NextAuth)
-- ============================================================================

-- Users can only access their own accounts
CREATE POLICY "accounts_own_access" ON "accounts"
    FOR ALL
    USING ("userId" = current_setting('app.current_user_id', true));

-- ============================================================================
-- CREATE SECURITY DEFINER FUNCTIONS
-- ============================================================================

-- Function to set current user context (called by application)
CREATE OR REPLACE FUNCTION set_current_user(user_id TEXT)
RETURNS void AS $$
BEGIN
    PERFORM set_config('app.current_user_id', user_id, true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get current user context
CREATE OR REPLACE FUNCTION get_current_user()
RETURNS TEXT AS $$
BEGIN
    RETURN current_setting('app.current_user_id', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- GRANT PERMISSIONS
-- ============================================================================

-- Grant execute permissions on the security functions
GRANT EXECUTE ON FUNCTION set_current_user(TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_current_user() TO PUBLIC;
