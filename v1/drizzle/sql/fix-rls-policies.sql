-- Fix RLS policies to be secure by default
-- Drop existing policies and recreate with proper security

-- ============================================================================
-- DROP EXISTING POLICIES
-- ============================================================================

DROP POLICY IF EXISTS "conversations_participant_access" ON "conversations";
DROP POLICY IF EXISTS "participants_conversation_access" ON "participants";
DROP POLICY IF EXISTS "messages_conversation_access" ON "messages";
DROP POLICY IF EXISTS "messages_insert_participant" ON "messages";
DROP POLICY IF EXISTS "attachments_message_access" ON "attachments";
DROP POLICY IF EXISTS "reactions_message_access" ON "reactions";
DROP POLICY IF EXISTS "reactions_insert_own" ON "reactions";
DROP POLICY IF EXISTS "receipts_message_access" ON "message_receipts";
DROP POLICY IF EXISTS "receipts_insert_own" ON "message_receipts";

-- ============================================================================
-- SECURE CONVERSATIONS TABLE POLICIES
-- ============================================================================

-- Users can only see conversations they participate in (must have valid user context)
CREATE POLICY "conversations_participant_access" ON "conversations"
    FOR ALL
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND current_setting('app.current_user_id', true) != ''
        AND EXISTS (
            SELECT 1 FROM "participants" p 
            WHERE p."conversationId" = id 
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- ============================================================================
-- SECURE PARTICIPANTS TABLE POLICIES  
-- ============================================================================

-- Users can see participants in conversations they're part of (must have valid user context)
CREATE POLICY "participants_conversation_access" ON "participants"
    FOR ALL
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND current_setting('app.current_user_id', true) != ''
        AND EXISTS (
            SELECT 1 FROM "participants" p 
            WHERE p."conversationId" = "conversationId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- ============================================================================
-- SECURE MESSAGES TABLE POLICIES
-- ============================================================================

-- Users can see messages in conversations they participate in (must have valid user context)
CREATE POLICY "messages_conversation_access" ON "messages"
    FOR SELECT
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND current_setting('app.current_user_id', true) != ''
        AND EXISTS (
            SELECT 1 FROM "participants" p 
            WHERE p."conversationId" = "conversationId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- Users can only insert messages to conversations they participate in (must have valid user context)
CREATE POLICY "messages_insert_participant" ON "messages"
    FOR INSERT
    WITH CHECK (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND current_setting('app.current_user_id', true) != ''
        AND "senderId" = current_setting('app.current_user_id', true)
        AND EXISTS (
            SELECT 1 FROM "participants" p 
            WHERE p."conversationId" = "conversationId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- ============================================================================
-- SECURE ATTACHMENTS TABLE POLICIES
-- ============================================================================

-- Users can see attachments for messages they can see (must have valid user context)
CREATE POLICY "attachments_message_access" ON "attachments"
    FOR ALL
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND current_setting('app.current_user_id', true) != ''
        AND EXISTS (
            SELECT 1 FROM "messages" m 
            JOIN "participants" p ON p."conversationId" = m."conversationId"
            WHERE m.id = "messageId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- ============================================================================
-- SECURE REACTIONS TABLE POLICIES
-- ============================================================================

-- Users can see reactions on messages they can see (must have valid user context)
CREATE POLICY "reactions_message_access" ON "reactions"
    FOR SELECT
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND current_setting('app.current_user_id', true) != ''
        AND EXISTS (
            SELECT 1 FROM "messages" m 
            JOIN "participants" p ON p."conversationId" = m."conversationId"
            WHERE m.id = "messageId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- Users can only create their own reactions (must have valid user context)
CREATE POLICY "reactions_insert_own" ON "reactions"
    FOR INSERT
    WITH CHECK (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND current_setting('app.current_user_id', true) != ''
        AND "userId" = current_setting('app.current_user_id', true)
        AND EXISTS (
            SELECT 1 FROM "messages" m 
            JOIN "participants" p ON p."conversationId" = m."conversationId"
            WHERE m.id = "messageId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- ============================================================================
-- SECURE MESSAGE RECEIPTS TABLE POLICIES
-- ============================================================================

-- Users can see receipts for messages they can see (must have valid user context)
CREATE POLICY "receipts_message_access" ON "message_receipts"
    FOR SELECT
    USING (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND current_setting('app.current_user_id', true) != ''
        AND EXISTS (
            SELECT 1 FROM "messages" m 
            JOIN "participants" p ON p."conversationId" = m."conversationId"
            WHERE m.id = "messageId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );

-- Users can only create receipts for themselves (must have valid user context)
CREATE POLICY "receipts_insert_own" ON "message_receipts"
    FOR INSERT
    WITH CHECK (
        current_setting('app.current_user_id', true) IS NOT NULL
        AND current_setting('app.current_user_id', true) != ''
        AND "userId" = current_setting('app.current_user_id', true)
        AND EXISTS (
            SELECT 1 FROM "messages" m 
            JOIN "participants" p ON p."conversationId" = m."conversationId"
            WHERE m.id = "messageId"
            AND p."userId" = current_setting('app.current_user_id', true)
            AND p."isActive" = true
        )
    );
